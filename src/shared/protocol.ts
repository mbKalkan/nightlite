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

export type HostToWebviewMessage = LoadMessage | ErrorMessage;

export type WebviewToHostMessage = { type: 'ready' };
