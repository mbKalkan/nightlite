import * as vscode from 'vscode';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../shared/protocol';
import { describeFile } from '../shared/sqliteHeader';
import { classifyDatabaseError, DatabaseDocument } from './databaseDocument';
import { readFileHeader } from './fileHeader';
import { pickObject } from './objectPicker';
import { viewerStrings } from './strings';
import { buildWebviewHtml } from './webviewHtml';

interface Editor {
  panel: vscode.WebviewPanel;
  document: DatabaseDocument;
}

export class ViewerProvider implements vscode.CustomReadonlyEditorProvider<DatabaseDocument> {
  static readonly viewType = 'nightlite.viewer';

  private active: Editor | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new ViewerProvider(context.extensionUri);
    return vscode.Disposable.from(
      vscode.window.registerCustomEditorProvider(ViewerProvider.viewType, provider, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      }),
      vscode.commands.registerCommand('nightlite.goToTable', () => provider.goToObject()),
    );
  }

  openCustomDocument(uri: vscode.Uri): DatabaseDocument {
    const worker = vscode.Uri.joinPath(this.extensionUri, 'dist', 'databaseWorker.js');
    return new DatabaseDocument(uri, worker.fsPath);
  }

  resolveCustomEditor(document: DatabaseDocument, panel: vscode.WebviewPanel): void {
    const distWebview = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    panel.webview.options = { enableScripts: true, localResourceRoots: [distWebview] };
    panel.webview.html = buildWebviewHtml({
      cspSource: panel.webview.cspSource,
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(distWebview, 'main.js')).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(distWebview, 'main.css')).toString(),
      lang: vscode.env.language,
    });

    const editor: Editor = { panel, document };
    const post = (message: HostToWebviewMessage) => panel.webview.postMessage(message);
    const subscriptions = [
      panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
        if (message.type === 'ready') {
          void this.load(document, post);
        }
      }),
      panel.onDidChangeViewState(() => this.track(editor)),
    ];
    this.track(editor);
    panel.onDidDispose(() => {
      subscriptions.forEach((subscription) => subscription.dispose());
      if (this.active === editor) {
        this.active = undefined;
      }
    });
  }

  private track(editor: Editor): void {
    if (editor.panel.active) {
      this.active = editor;
    } else if (this.active === editor) {
      this.active = undefined;
    }
  }

  private async load(
    document: DatabaseDocument,
    post: (message: HostToWebviewMessage) => Thenable<boolean>,
  ): Promise<void> {
    const { uri } = document;
    const strings = viewerStrings();
    const fileName = uri.path.slice(uri.path.lastIndexOf('/') + 1);
    // SQLite reads the file in place, so it has to be on a disk this extension host can reach.
    if (uri.scheme !== 'file') {
      await post({ type: 'error', fileName, error: 'notOnDisk', strings });
      return;
    }
    let header: { bytes: Uint8Array; size: number };
    try {
      header = await readFileHeader(uri.fsPath);
    } catch {
      await post({ type: 'error', fileName, error: 'unreadable', strings });
      return;
    }
    const result = describeFile(uri.path, header.bytes, header.size);
    if ('error' in result) {
      await post({ type: 'error', fileName, error: result.error, strings });
      return;
    }
    // The header alone shows at once; the schema follows as soon as the database is open.
    await post({ type: 'load', file: result.file, locale: vscode.env.language, strings });
    try {
      await post({ type: 'schema', objects: await document.schema(result.file.header) });
    } catch (error) {
      await post({ type: 'schemaError', ...classifyDatabaseError(error) });
    }
  }

  private async goToObject(): Promise<void> {
    const editor = this.active;
    const header = editor?.document.header;
    if (!editor || !header) {
      return;
    }
    let objects;
    try {
      objects = await editor.document.schema(header);
    } catch {
      return;
    }
    const name = await pickObject(objects);
    if (name !== undefined) {
      editor.panel.reveal();
      void editor.panel.webview.postMessage({
        type: 'reveal',
        name,
      } satisfies HostToWebviewMessage);
    }
  }
}
