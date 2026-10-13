// Messages exchanged between the extension host and the webview.

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
  cellDetail: string;
  resizeDetail: string;
  copyValue: string;
  close: string;
  noCell: string;
  /** `{0}` is a number of characters, or a size. */
  showingCharacters: string;
  showingBytes: string;
  cellErrorTitle: string;
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
}

/** A cell's value, answering `cell`. */
export interface CellValueMessage {
  type: 'cellValue';
  request: number;
  name: string;
  cell: FullCell;
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
  | ObjectInfoMessage
  | RowCountMessage
  | RowPageMessage
  | ObjectErrorMessage
  | CopiedMessage
  | CellValueMessage;

export type WebviewToHostMessage =
  | { type: 'ready' }
  /** Asks for a table's or view's columns and row estimate; the count follows by itself. */
  | { type: 'openObject'; name: string }
  /** Asks for `count` rows from position `start`; `total` is the row count the grid assumes. */
  | { type: 'rows'; request: number; name: string; start: number; count: number; total: number }
  /** Copies full values as tab-separated text; the extension host writes the clipboard. */
  | { type: 'copy'; request: number; name: string; range: CopyRange }
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
