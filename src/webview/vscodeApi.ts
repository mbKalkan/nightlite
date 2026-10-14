import type { WebviewToHostMessage } from '../shared/protocol';
import type { RowView } from '../shared/rowFilter';
import type { RowScheme, TileKey } from '../shared/tiles';

/** What the webview remembers across reloads and while its tab is in the background. */
export interface ViewState {
  /** The sidebar entry last shown. */
  selected?: string;
  /** Whether tables open on their rows or their schema. */
  tab?: 'data' | 'schema';
  /** Whether the cell detail panel is open beside the rows. */
  detail?: boolean;
  /** Its width in pixels, once resized. */
  detailWidth?: number;
  /** The tile browser's tile, row numbering and hidden layers. */
  tile?: TileKey;
  scheme?: RowScheme;
  hiddenLayers?: string[];
  /** The statement on the query page. */
  sql?: string;
  /** How tables' rows are sorted and filtered, by table; plain ones are left out. */
  views?: Record<string, RowView>;
  /** Whether the row of column filters shows. */
  filterRow?: boolean;
}

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
  getState(): ViewState | undefined;
  setState(state: ViewState): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();
