import type { WebviewToHostMessage } from '../shared/protocol';

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();
