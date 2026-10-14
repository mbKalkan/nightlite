import * as vscode from 'vscode';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../shared/protocol';
import { describeFile } from '../shared/sqliteHeader';
import { DatabaseDocument } from './databaseDocument';
import { classifyDatabaseError } from './databaseErrors';
import { readFileHeader } from './fileHeader';
import { saveErrorMessage } from './saveErrors';
import { watchDatabase } from './fileWatcher';
import { pickObject } from './objectPicker';
import { answer } from './requests';
import { saveTile } from './saveTile';
import { viewerStrings } from './strings';
import { buildWebviewHtml } from './webviewHtml';

interface Editor {
  panel: vscode.WebviewPanel;
  document: DatabaseDocument;
}

/**
 * Shows SQLite files of every kind. The provider is an editable one because an MBTiles file's
 * metadata can be edited and saved (D-005); nothing else is ever changed, so other files never
 * become dirty.
 */
export class ViewerProvider implements vscode.CustomEditorProvider<DatabaseDocument> {
  static readonly viewType = 'nightlite.viewer';

  private active: Editor | undefined;
  private readonly edits = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<DatabaseDocument>
  >();
  readonly onDidChangeCustomDocument = this.edits.event;

  constructor(private readonly extensionUri: vscode.Uri) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new ViewerProvider(context.extensionUri);
    return vscode.Disposable.from(
      vscode.window.registerCustomEditorProvider(ViewerProvider.viewType, provider, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      }),
      vscode.commands.registerCommand('nightlite.goToTable', () => provider.goToObject()),
      provider.edits,
    );
  }

  async openCustomDocument(
    uri: vscode.Uri,
    context: vscode.CustomDocumentOpenContext,
  ): Promise<DatabaseDocument> {
    const worker = vscode.Uri.joinPath(this.extensionUri, 'dist', 'databaseWorker.js');
    const document = new DatabaseDocument(uri, worker.fsPath);
    if (context.backupId) {
      // Metadata changes kept when VS Code closed with them unsaved.
      try {
        const backup = await vscode.workspace.fs.readFile(vscode.Uri.parse(context.backupId));
        document.metadata.restore(new TextDecoder().decode(backup));
      } catch {
        // A backup that can't be read is left out; the file itself is as it was.
      }
    }
    if (uri.scheme === 'file') {
      // Our own save changes the file too; that needs no reload.
      document.own(
        watchDatabase(uri, () => {
          void document.isOwnWrite().then((own) => {
            if (!own) document.reset();
          });
        }),
      );
    }
    return document;
  }

  async saveCustomDocument(document: DatabaseDocument): Promise<void> {
    if (await document.changedSinceRead()) {
      const save = vscode.l10n.t('Save');
      const name = document.uri.path.slice(document.uri.path.lastIndexOf('/') + 1);
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t(
          '{0} changed on disk since Nightlite read it. Save the metadata changes into it anyway?',
          name,
        ),
        { modal: true },
        save,
      );
      if (choice !== save) throw new vscode.CancellationError();
    }
    try {
      await document.saveMetadata();
    } catch (error) {
      // VS Code shows the message and keeps the changes, still unsaved.
      throw new Error(saveErrorMessage(error), { cause: error });
    }
  }

  saveCustomDocumentAs(): Promise<void> {
    return Promise.reject(
      new Error(
        vscode.l10n.t(
          "Save As isn't available here: saving writes the metadata into the tileset itself.",
        ),
      ),
    );
  }

  async revertCustomDocument(document: DatabaseDocument): Promise<void> {
    document.revertMetadata();
  }

  async backupCustomDocument(
    document: DatabaseDocument,
    context: vscode.CustomDocumentBackupContext,
  ): Promise<vscode.CustomDocumentBackup> {
    await vscode.workspace.fs.writeFile(
      context.destination,
      new TextEncoder().encode(document.metadata.backup()),
    );
    return {
      id: context.destination.toString(),
      delete: () => void vscode.workspace.fs.delete(context.destination).then(undefined, () => {}),
    };
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
        } else if (message.type === 'reopenWith') {
          void vscode.commands.executeCommand('workbench.action.reopenWithEditor', document.uri);
        } else {
          // An answer worked out before the file changed would describe the file as it was.
          const generation = document.generation;
          const current = (reply: HostToWebviewMessage) =>
            document.generation === generation ? post(reply) : Promise.resolve(false);
          void answer(message, document, current, {
            writeClipboard: (text) => vscode.env.clipboard.writeText(text),
            saveTile: (name, stored) => saveTile(document.uri, name, stored),
            onMetadataEdit: (edit) =>
              this.edits.fire({
                document,
                label: vscode.l10n.t('Edit Metadata'),
                undo: () => edit.undo(),
                redo: () => edit.redo(),
              }),
          });
        }
      }),
      document.onReset(() => void this.load(document, post)),
      document.onMetadata((saved) => void this.postMetadata(document, post, saved)),
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

  /** The metadata as edited now; after a save, the tileset's summary read afresh too. */
  private async postMetadata(
    document: DatabaseDocument,
    post: (message: HostToWebviewMessage) => Thenable<boolean>,
    saved: boolean,
  ): Promise<void> {
    try {
      await post({ type: 'metadataState', state: await document.metadataState() });
      if (saved) await post({ type: 'mbtiles', summary: await document.mbtiles() });
    } catch (error) {
      await post({ type: 'metadataError', ...classifyDatabaseError(error) });
    }
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
    const strings = viewerStrings(vscode.l10n);
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
