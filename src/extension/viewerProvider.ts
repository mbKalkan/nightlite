import * as vscode from 'vscode';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../shared/protocol';
import { describeFile } from '../shared/sqliteHeader';
import { readFileHeader } from './fileHeader';
import { viewerStrings } from './strings';
import { buildWebviewHtml } from './webviewHtml';

export class ViewerProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = 'nightlite.viewer';

  constructor(private readonly extensionUri: vscode.Uri) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new ViewerProvider(context.extensionUri);
    return vscode.window.registerCustomEditorProvider(ViewerProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    });
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    const distWebview = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    panel.webview.options = { enableScripts: true, localResourceRoots: [distWebview] };
    panel.webview.html = buildWebviewHtml({
      cspSource: panel.webview.cspSource,
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(distWebview, 'main.js')).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(distWebview, 'main.css')).toString(),
      lang: vscode.env.language,
    });

    const post = (message: HostToWebviewMessage) => panel.webview.postMessage(message);
    const subscription = panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
      if (message.type === 'ready') {
        void this.load(document.uri, post);
      }
    });
    panel.onDidDispose(() => subscription.dispose());
  }

  private async load(
    uri: vscode.Uri,
    post: (message: HostToWebviewMessage) => Thenable<boolean>,
  ): Promise<void> {
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
    await post(
      'error' in result
        ? { type: 'error', fileName, error: result.error, strings }
        : { type: 'load', file: result.file, locale: vscode.env.language, strings },
    );
  }
}
