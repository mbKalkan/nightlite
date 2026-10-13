import { randomBytes } from 'node:crypto';

export interface WebviewHtmlOptions {
  /** `webview.cspSource`: the origin the webview loads extension resources from. */
  cspSource: string;
  scriptUri: string;
  styleUri: string;
  lang: string;
  nonce?: string;
}

export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

export function buildContentSecurityPolicy(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    // Pictures stored in databases (tiles, BLOBs) are shown from blob: and data: URLs.
    `img-src ${cspSource} blob: data:`,
    `font-src ${cspSource}`,
    // Virtualized grids draw rows as HTML with inline positions.
    `style-src ${cspSource} 'unsafe-inline'`,
    // Lazily loaded chunks are served from the extension's dist folder.
    `script-src 'nonce-${nonce}' ${cspSource}`,
  ].join('; ');
}

export function buildWebviewHtml(options: WebviewHtmlOptions): string {
  const nonce = options.nonce ?? createNonce();
  const csp = buildContentSecurityPolicy(options.cspSource, nonce);
  return `<!DOCTYPE html>
<html lang="${escapeAttribute(options.lang)}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${escapeAttribute(options.styleUri)}">
</head>
<body>
  <div id="app"></div>
  <script type="module" nonce="${escapeAttribute(nonce)}" src="${escapeAttribute(options.scriptUri)}"></script>
</body>
</html>`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
