import type { ViewerStrings } from '../shared/protocol';

/** VS Code's `l10n`, or any function with its shape; tests pass one that returns the English. */
export interface Localizer {
  t(message: string, ...args: string[]): string;
}

/**
 * The webview's strings, localized here because only the extension host has VS Code's l10n.
 * Templates keep their `{0}`: the webview fills them in.
 */
export function viewerStrings(l10n: Localizer): ViewerStrings {
  return {
    errorTitle: l10n.t("This file can't be displayed"),
    errorEmpty: l10n.t('The file is empty.'),
    errorNotSqlite: l10n.t("The file isn't a SQLite database, or it's encrypted."),
    errorUnreadable: l10n.t("The file couldn't be read."),
    errorNotOnDisk: l10n.t(
      'Nightlite opens files on a disk. Save a copy into your workspace and open that.',
    ),
    formatSqlite: l10n.t('SQLite database'),
    formatMbtiles: l10n.t('MBTiles tileset'),
    formatGeopackage: l10n.t('GeoPackage'),
    fileSize: l10n.t('File size'),
    pages: l10n.t('Pages'),
    pagesValue: l10n.t('{0} × {1}'),
    textEncoding: l10n.t('Text encoding'),
    journal: l10n.t('Journal'),
    journalWal: l10n.t('Write-ahead log (WAL)'),
    journalRollback: l10n.t('Rollback journal'),
    userVersion: l10n.t('User version'),
    applicationId: l10n.t('Application ID'),
    writtenBy: l10n.t('Last written by'),
    databaseObjects: l10n.t('Database objects'),
    overview: l10n.t('Overview'),
    tables: l10n.t('Tables'),
    views: l10n.t('Views'),
    indexes: l10n.t('Indexes'),
    triggers: l10n.t('Triggers'),
    noTables: l10n.t('This database has no tables yet.'),
    expand: l10n.t('Expand'),
    collapse: l10n.t('Collapse'),
    table: l10n.t('Table'),
    view: l10n.t('View'),
    index: l10n.t('Index'),
    trigger: l10n.t('Trigger'),
    virtualTable: l10n.t('Virtual table'),
    internalTable: l10n.t('SQLite internal'),
    withoutRowid: l10n.t('WITHOUT ROWID'),
    strict: l10n.t('STRICT'),
    onTable: l10n.t('on {0}'),
    noSql: l10n.t('SQLite keeps no CREATE statement for this object.'),
    openErrorTitle: l10n.t("The database couldn't be opened"),
    openErrorDamaged: l10n.t('The database file is damaged.'),
    openErrorLocked: l10n.t(
      'Another program is writing to the database right now. Reopen it when that program is done.',
    ),
    openErrorOther: l10n.t('SQLite reported a problem with this database.'),
    pageTabs: l10n.t('Show'),
    data: l10n.t('Data'),
    schema: l10n.t('Schema'),
    rowsOf: l10n.t('Rows of {0}'),
    rowCount: l10n.t('{0} rows'),
    oneRow: l10n.t('1 row'),
    rowEstimate: l10n.t('About {0} rows'),
    counting: l10n.t('counting…'),
    columnCount: l10n.t('{0} columns'),
    noRows: l10n.t('This table has no rows.'),
    rowid: l10n.t('rowid'),
    primaryKey: l10n.t('Primary key'),
    rowsErrorTitle: l10n.t("These rows couldn't be read"),
    oneColumn: l10n.t('1 column'),
    characters: l10n.t('{0} characters'),
    copying: l10n.t('Copying…'),
    copiedValue: l10n.t('Copied the value.'),
    copiedRow: l10n.t('Copied 1 row.'),
    copiedRows: l10n.t('Copied {0} rows.'),
    copiedStopped: l10n.t('Copied the first {0} rows: a copy holds at most {1} rows or {2}.'),
    copiedCut: l10n.t('Copied, with values longer than {0} cut short.'),
    copyFailed: l10n.t("Couldn't copy: {0}"),
  };
}
