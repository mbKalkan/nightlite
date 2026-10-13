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

export type HostToWebviewMessage =
  LoadMessage | ErrorMessage | SchemaMessage | SchemaErrorMessage | RevealMessage;

export type WebviewToHostMessage = { type: 'ready' };
