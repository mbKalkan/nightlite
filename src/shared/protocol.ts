// Messages exchanged between the extension host and the webview.

import type { TileKey } from './tiles';

/** What a SQLite file holds, as far as the viewer tells them apart. */
export type FileFormat = 'sqlite' | 'mbtiles' | 'geopackage';

/** Facts from the 100-byte database header, read without opening the database. */
export interface DatabaseHeader {
  pageSize: number;
  /** From the header when it's current, otherwise from the file size. */
  pageCount: number;
  textEncoding: 'UTF-8' | 'UTF-16le' | 'UTF-16be';
  /** Whether the database uses a write-ahead log rather than a rollback journal. */
  wal: boolean;
  userVersion: number;
  applicationId: number;
  /** The SQLite version that last wrote the file, like `3.53.4`. */
  sqliteVersion: string;
}

export interface FileInfo {
  fileName: string;
  fileSize: number;
  format: FileFormat;
  header: DatabaseHeader;
}

/** Why a file can't be shown: `notOnDisk` covers files of virtual file systems. */
export type LoadError = 'empty' | 'notSqlite' | 'unreadable' | 'notOnDisk';

export type ObjectType = 'table' | 'view' | 'index' | 'trigger';

/** A table, view, index or trigger, as the database's schema lists it. */
export interface SchemaObject {
  type: ObjectType;
  name: string;
  /** The table or view an index or trigger belongs to; for tables and views, the object itself. */
  tableName: string;
  /** The CREATE statement as it was written. */
  sql: string | null;
  /** SQLite's own tables, like sqlite_sequence, and the tables that hold a virtual table's data. */
  internal: boolean;
  /** A virtual table, like a full-text or R*Tree index. */
  virtual: boolean;
  withoutRowid: boolean;
  strict: boolean;
}

/** A column as `PRAGMA table_xinfo` describes it. */
export interface ColumnInfo {
  name: string;
  /** The declared type, as written; SQLite doesn't hold values to it unless the table is STRICT. */
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  /** 1-based position in the primary key, 0 when not part of it. */
  primaryKey: number;
  generated: boolean;
}

export interface IndexSummary {
  name: string;
  unique: boolean;
  /** Made by CREATE INDEX (c), or by SQLite for a UNIQUE (u) or PRIMARY KEY (pk) constraint. */
  origin: 'c' | 'u' | 'pk';
  partial: boolean;
  /** Column names; null for an expression. */
  columns: (string | null)[];
}

export interface ForeignKey {
  table: string;
  from: string[];
  /** The referenced columns; null where the key refers to the other table's primary key. */
  to: (string | null)[];
  onUpdate: string;
  onDelete: string;
}

export interface IndexColumn {
  /** Null for an expression. */
  name: string | null;
  descending: boolean;
  collation: string;
}

/** What the Schema page lists beside the CREATE statement, answering `objectDetails`. */
export interface ObjectDetails {
  columns?: (ColumnInfo & { hidden: boolean })[];
  indexes?: IndexSummary[];
  foreignKeys?: ForeignKey[];
  /** An index's own key columns. */
  indexColumns?: IndexColumn[];
}

/** What the grid needs to know about a table or view before reading its rows. */
export interface ObjectInfo {
  name: string;
  columns: ColumnInfo[];
  /** Rowid tables show their rowids and can jump anywhere at once. */
  hasRowid: boolean;
  /** Rows estimated from the rowid span, until counted; null when there is no quick estimate. */
  estimate: number | null;
}

/**
 * A cell value, JSON-safe and exact: integers beyond 2^53 and infinite reals travel as text,
 * long text as its first part and full length, BLOBs as their size and first bytes in hex.
 */
export type CellValue =
  null | number | string | { text: string; length: number } | { size: number; head: string };

/** Rows `start` onwards of a table or view. */
export interface RowPage {
  start: number;
  rows: CellValue[][];
  /** Each row's storage classes, one letter per column: n, i (integer), f (real), t, b. */
  types: string[];
  /** Each row's rowid, as text, for rowid tables. */
  rowids?: string[];
  /** True when the table ended within this page. */
  end: boolean;
}

/** Why a database whose header is fine still couldn't be opened or read. */
export type DatabaseError = 'damaged' | 'notSqlite' | 'locked' | 'unreadable' | 'other';

/** UI strings localized by the extension host and handed to the webview. */
export interface ViewerStrings {
  errorTitle: string;
  errorEmpty: string;
  errorNotSqlite: string;
  errorUnreadable: string;
  errorNotOnDisk: string;
  formatSqlite: string;
  formatMbtiles: string;
  formatGeopackage: string;
  fileSize: string;
  /** `{0} × {1}`: the number of pages and the page size. */
  pages: string;
  pagesValue: string;
  textEncoding: string;
  journal: string;
  journalWal: string;
  journalRollback: string;
  userVersion: string;
  applicationId: string;
  writtenBy: string;
  /** The sidebar and what it lists. */
  databaseObjects: string;
  overview: string;
  tables: string;
  views: string;
  indexes: string;
  triggers: string;
  noTables: string;
  expand: string;
  collapse: string;
  /** Kinds and traits shown next to an object's name. */
  table: string;
  view: string;
  index: string;
  trigger: string;
  virtualTable: string;
  internalTable: string;
  withoutRowid: string;
  strict: string;
  /** `on {0}`: the table an index or trigger belongs to. */
  onTable: string;
  /** Shown when SQLite keeps no CREATE statement for an object. */
  noSql: string;
  /** The database couldn't be opened although its header is fine. */
  openErrorTitle: string;
  openErrorDamaged: string;
  openErrorLocked: string;
  openErrorOther: string;
  /** The Data and Schema tabs of a table or view. */
  pageTabs: string;
  data: string;
  schema: string;
  /** Rows of `{0}`: the accessible name of the grid. */
  rowsOf: string;
  /** Status bar counts; `{0}` is a number. */
  rowCount: string;
  oneRow: string;
  rowEstimate: string;
  counting: string;
  columnCount: string;
  noRows: string;
  /** Shown in the grid's corner over rowids, and for cells. */
  rowid: string;
  primaryKey: string;
  rowsErrorTitle: string;
  oneColumn: string;
  /** `{0} characters`: the full length of text the grid shows cut short. */
  characters: string;
  copying: string;
  /** What copying put on the clipboard; `{0}` and `{1}` are numbers, `{2}` a size. */
  copiedValue: string;
  copiedRow: string;
  copiedRows: string;
  copiedStopped: string;
  copiedCut: string;
  copyFailed: string;
  /** The cell detail panel: its name, the toolbar button that shows it, and its parts. */
  reopenWith: string;
  cellDetail: string;
  resizeDetail: string;
  copyValue: string;
  close: string;
  noCell: string;
  /** `{0}` is a number of characters, or a size. */
  showingCharacters: string;
  showingBytes: string;
  cellErrorTitle: string;
  /** The Schema page's lists beside the CREATE statement. */
  columnsHeading: string;
  foreignKeysHeading: string;
  statementHeading: string;
  nameColumn: string;
  typeColumn: string;
  constraintsColumn: string;
  expression: string;
  automaticIndex: string;
  partialIndex: string;
  detailsErrorTitle: string;
  /** The overview of a database: its tables and their sizes. */
  rowsColumn: string;
  countingRows: string;
  countRowsFailed: string;
  moreTables: string;
  /** The MBTiles summary: its sections and what they say. */
  tilesHeading: string;
  zoomColumn: string;
  tileCount: string;
  oneTile: string;
  tilesAtZooms: string;
  tilesAtZoom: string;
  countingTiles: string;
  countFailed: string;
  noTiles: string;
  noTilesTable: string;
  tilesIsView: string;
  minzoomMismatch: string;
  maxzoomMismatch: string;
  layersHeading: string;
  layerZoom: string;
  layerFeatures: string;
  noFields: string;
  metadataHeading: string;
  mdName: string;
  mdDescription: string;
  mdFormat: string;
  mdType: string;
  mdVersion: string;
  mdZoom: string;
  mdBounds: string;
  mdCenter: string;
  mdAttribution: string;
  boundsValue: string;
  centerValue: string;
  centerZoom: string;
  vectorTiles: string;
  rasterTiles: string;
  missingMetadata: string;
  invalidMetadata: string;
  noMetadata: string;
  fileHeading: string;
  mbtilesErrorTitle: string;
  /** The tile browser: its toolbar, its list, and what it says about a tile. */
  tileBrowser: string;
  goToTile: string;
  tileAddressHint: string;
  invalidAddress: string;
  rowScheme: string;
  xyzHint: string;
  tmsHint: string;
  tilesAtZoomList: string;
  zoomOption: string;
  tileHeading: string;
  tileNavigation: string;
  moveWest: string;
  moveEast: string;
  moveNorth: string;
  moveSouth: string;
  zoomIn: string;
  zoomOut: string;
  noTileAt: string;
  noTileHint: string;
  emptyTile: string;
  tileTooLarge: string;
  tileDamaged: string;
  tileUnknown: string;
  tileUnreadable: string;
  imageTile: string;
  vectorTile: string;
  imageSize: string;
  compressedSize: string;
  layerCount: string;
  oneLayer: string;
  oneFeature: string;
  pointCount: string;
  onePoint: string;
  lineCount: string;
  oneLine: string;
  polygonCount: string;
  onePolygon: string;
  otherCount: string;
  layerExtent: string;
  tileLayersHeading: string;
  tilesErrorTitle: string;
  /** The features under the pointer, or kept in view, with their attributes. */
  featuresHeading: string;
  inspectHint: string;
  featureId: string;
  noAttributes: string;
  saveTile: string;
  /** How the cell detail shows a BLOB. */
  showAs: string;
  viewImage: string;
  viewText: string;
  viewHex: string;
  /** The metadata editor: its note, its rows and what it says about values. */
  metadataHint: string;
  metadataNoTable: string;
  metadataIsView: string;
  newKey: string;
  addKey: string;
  removeKey: string;
  changedKey: string;
  keyCopies: string;
  valueTooLong: string;
  issueFormat: string;
  issueBounds: string;
  issueCenter: string;
  issueZoom: string;
  issueType: string;
  issueJson: string;
  zoomOrder: string;
}

export interface LoadMessage {
  type: 'load';
  file: FileInfo;
  /** VS Code's display language, for numbers and sizes. */
  locale: string;
  strings: ViewerStrings;
}

export interface ErrorMessage {
  type: 'error';
  fileName: string;
  error: LoadError;
  strings: ViewerStrings;
}

/** The database's tables, views, indexes and triggers, sent once it's open. */
export interface SchemaMessage {
  type: 'schema';
  objects: SchemaObject[];
}

/** The header was fine but the database couldn't be opened or its schema read. */
export interface SchemaErrorMessage {
  type: 'schemaError';
  error: DatabaseError;
  /** SQLite's own words, shown under the explanation. */
  detail: string;
}

/** Selects an object in the sidebar, as Go to Table does. */
export interface RevealMessage {
  type: 'reveal';
  name: string;
}

/** Copy or Copy as Markdown Table, from the context menu or the Command Palette. */
export interface CopySelectionMessage {
  type: 'copySelection';
  markdown: boolean;
}

/** A table's or view's columns and row estimate, answering `openObject`. */
export interface ObjectInfoMessage {
  type: 'objectInfo';
  info: ObjectInfo;
}

/** The exact row count, once counted in the background. */
export interface RowCountMessage {
  type: 'rowCount';
  name: string;
  count: number;
}

/** Rows answering a `rows` request. */
export interface RowPageMessage {
  type: 'rowPage';
  request: number;
  name: string;
  page: RowPage;
}

/** A table's columns or rows couldn't be read, like a damaged table or a missing module. */
export interface ObjectErrorMessage {
  type: 'objectError';
  name: string;
  /** The `rows` or `copy` request that failed, if it was one. */
  request?: number;
  error: DatabaseError;
  detail: string;
}

/** Rows and columns to copy, by position; a `count` of null copies to the last row. */
export interface CopyRange {
  start: number;
  count: number | null;
  /** The row count the grid works with, as for `rows`. */
  total: number;
  firstColumn: number;
  lastColumn: number;
  /** As a Markdown table headed by the column names, instead of tab-separated text. */
  markdown?: boolean;
}

/** How much a copy put on the clipboard. */
export interface CopyResult {
  rows: number;
  cells: number;
  /** Rows were left out: the selection is more than a copy holds. */
  stopped: boolean;
  /** Some value was longer than the limit and was cut. */
  cut: boolean;
}

/**
 * One cell's value for the detail panel, as text: numbers as the grid shows them, text up to
 * DETAIL_TEXT characters, a BLOB's first DETAIL_BYTES bytes as hex. `length` is the whole
 * value's, in characters or bytes.
 */
export interface FullCell {
  type: string;
  text: string;
  length: number;
  /** A BLOB's bytes in full, when they're an image or text the detail can show as such. */
  bytes?: Uint8Array;
}

/** A cell's value, answering `cell`. */
export interface CellValueMessage {
  type: 'cellValue';
  request: number;
  name: string;
  cell: FullCell;
}

export interface ObjectDetailsMessage {
  type: 'objectDetails';
  name: string;
  details: ObjectDetails;
}

export interface ObjectDetailsErrorMessage {
  type: 'objectDetailsError';
  name: string;
  error: DatabaseError;
  detail: string;
}

/** A table's size, for the overview: its rows, counted, and its columns. */
export interface TableSummary {
  rows: number;
  columns: number;
}

/** One table summarized in the background; null when it couldn't be counted. */
export interface TableSummaryMessage {
  type: 'tableSummary';
  name: string;
  summary: TableSummary | null;
}

export interface TableSummariesEndMessage {
  type: 'tableSummariesEnd';
  complete: boolean;
}

/** What an MBTiles file says about itself, answering `mbtiles`. */
export interface MbtilesSummary {
  /** The metadata table's rows as text; null when there is no metadata table. */
  metadata: [string, string][] | null;
  /** A table as the spec has it, a view over deduplicated tiles, or none at all. */
  tiles: 'table' | 'view' | 'virtual' | null;
}

export interface ZoomRange {
  min: number;
  max: number;
}

export interface MbtilesMessage {
  type: 'mbtiles';
  summary: MbtilesSummary;
}

export interface MbtilesErrorMessage {
  type: 'mbtilesError';
  error: DatabaseError;
  detail: string;
}

/** Tiles by zoom level, counted in the background: the range first, then each level. */
export interface ZoomRangeMessage {
  type: 'zoomRange';
  /** Null when there are no tiles. */
  range: ZoomRange | null;
}

export interface ZoomCountMessage {
  type: 'zoomCount';
  zoom: number;
  count: number;
}

/** Counting ended: every level counted, or stopped for another count or an error. */
export interface ZoomCountsEndMessage {
  type: 'zoomCountsEnd';
  complete: boolean;
}

/** One zoom level's tiles from position `start` on, by column and then row: [column, row]. */
export interface TilePage {
  start: number;
  tiles: [number, number][];
  /** True when the zoom level's tiles ended within this page. */
  end: boolean;
}

/** A tile's bytes, uncompressed for the webview when stored compressed. */
export interface TileContent {
  /** The size as stored. */
  size: number;
  compression: 'gzip' | 'zlib' | null;
  /** Null when the tile is too large to show, or its compressed bytes are damaged. */
  data: Uint8Array | null;
  problem?: 'tooLarge' | 'damaged';
}

/** Tiles answering `tiles`. */
export interface TilePageMessage {
  type: 'tilePage';
  request: number;
  zoom: number;
  page: TilePage;
}

/** Where a tile is in its zoom level's list, or would be: answers `locateTile`. */
export interface TilePositionMessage {
  type: 'tilePosition';
  request: number;
  key: TileKey;
  position: number;
}

/** A tile's content, answering `tile`; null when there's no tile at the place. */
export interface TileContentMessage {
  type: 'tileContent';
  request: number;
  key: TileKey;
  content: TileContent | null;
}

export interface TilesErrorMessage {
  type: 'tilesError';
  request: number;
  error: DatabaseError;
  detail: string;
}

/** A metadata key as the editor shows it: its value with the changes not saved yet. */
export interface MetadataEntry {
  name: string;
  value: string;
  /** Changed or added since the file was last saved. */
  changed: boolean;
  /** Not in the file yet. */
  added: boolean;
  /** How many times the file has the key; saving a change keeps one. */
  copies: number;
  /** The value's full length when it's too long to edit here, and shown cut. */
  cutFrom?: number;
}

/** The metadata as it would be saved, and whether it can be edited at all. */
export interface MetadataState {
  /** Why the metadata can't be edited: the file has no metadata table, or it's a view. */
  readOnly?: 'noTable' | 'view';
  entries: MetadataEntry[];
}

export interface MetadataStateMessage {
  type: 'metadataState';
  state: MetadataState;
}

export interface MetadataErrorMessage {
  type: 'metadataError';
  error: DatabaseError;
  detail: string;
}

/** The selection is on the clipboard, answering `copy`. */
export interface CopiedMessage {
  type: 'copied';
  request: number;
  name: string;
  result: CopyResult;
}

export type HostToWebviewMessage =
  | LoadMessage
  | ErrorMessage
  | SchemaMessage
  | SchemaErrorMessage
  | RevealMessage
  | CopySelectionMessage
  | ObjectInfoMessage
  | RowCountMessage
  | RowPageMessage
  | ObjectErrorMessage
  | CopiedMessage
  | CellValueMessage
  | MbtilesMessage
  | MbtilesErrorMessage
  | ZoomRangeMessage
  | ZoomCountMessage
  | ZoomCountsEndMessage
  | ObjectDetailsMessage
  | ObjectDetailsErrorMessage
  | TableSummaryMessage
  | TableSummariesEndMessage
  | TilePageMessage
  | TilePositionMessage
  | TileContentMessage
  | TilesErrorMessage
  | MetadataStateMessage
  | MetadataErrorMessage;

export type WebviewToHostMessage =
  | { type: 'ready' }
  /** Opens VS Code's picker to show the file in another editor, as for a file this can't show. */
  | { type: 'reopenWith' }
  /** Asks for a table's or view's columns and row estimate; the count follows by itself. */
  | { type: 'openObject'; name: string }
  /** Asks for `count` rows from position `start`; `total` is the row count the grid assumes. */
  | { type: 'rows'; request: number; name: string; start: number; count: number; total: number }
  /** Copies full values as tab-separated text; the extension host writes the clipboard. */
  | { type: 'copy'; request: number; name: string; range: CopyRange }
  /** Asks for an object's columns, indexes and foreign keys, for its Schema page. */
  | { type: 'objectDetails'; name: string }
  /** Counts the rows of these tables in the background, for the overview. */
  | { type: 'tableSummaries'; names: string[] }
  /** Asks for an MBTiles file's metadata. */
  | { type: 'mbtiles' }
  /** Starts counting tiles by zoom level, leaving out levels already counted. */
  | { type: 'zoomCounts'; skip: number[] }
  /** Asks for `count` tiles of a zoom level from position `start`; `total` is its tile count. */
  | { type: 'tiles'; request: number; zoom: number; start: number; count: number; total: number }
  /** Asks where a tile is in its zoom level's list. */
  | { type: 'locateTile'; request: number; key: TileKey; total: number }
  /** Asks for a tile's content. */
  | { type: 'tile'; request: number; key: TileKey }
  /** Asks for the metadata as the editor shows it; changes to it follow by themselves. */
  | { type: 'metadata' }
  /**
   * Sets a metadata key to a value, or removes it with null, until the file is saved. `amend`
   * folds a keystroke into the edit being typed into that key, so it undoes as one.
   */
  | { type: 'editMetadata'; name: string; value: string | null; amend?: boolean }
  /** Saves a tile as stored to a file the user picks; `name` is the file name, less its extension. */
  | { type: 'saveTile'; request: number; key: TileKey; name: string }
  /** Asks for one cell's value, by its row's rowid when known, else by position. */
  | {
      type: 'cell';
      request: number;
      name: string;
      row: number;
      total: number;
      column: number;
      rowid?: string;
    };
