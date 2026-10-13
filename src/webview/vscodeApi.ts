import type { WebviewToHostMessage } from '../shared/protocol';

/** What the webview remembers across reloads and while its tab is in the background. */
export interface ViewState {
  /** The sidebar entry last shown. */
  selected?: string;
  /** Whether tables open on their rows or their schema. */
  tab?: 'data' | 'schema';
}

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
  getState(): ViewState | undefined;
  setState(state: ViewState): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();
