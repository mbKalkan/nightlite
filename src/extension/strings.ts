import * as vscode from 'vscode';
import type { ViewerStrings } from '../shared/protocol';

export function viewerStrings(): ViewerStrings {
  return {
    errorTitle: vscode.l10n.t("This file can't be displayed"),
    errorEmpty: vscode.l10n.t('The file is empty.'),
    errorNotSqlite: vscode.l10n.t("The file isn't a SQLite database, or it's encrypted."),
    errorUnreadable: vscode.l10n.t("The file couldn't be read."),
    errorNotOnDisk: vscode.l10n.t(
      'Nightlite opens files on a disk. Save a copy into your workspace and open that.',
    ),
    formatSqlite: vscode.l10n.t('SQLite database'),
    formatMbtiles: vscode.l10n.t('MBTiles tileset'),
    formatGeopackage: vscode.l10n.t('GeoPackage'),
    fileSize: vscode.l10n.t('File size'),
    pages: vscode.l10n.t('Pages'),
    pagesValue: vscode.l10n.t('{0} × {1}'),
    textEncoding: vscode.l10n.t('Text encoding'),
    journal: vscode.l10n.t('Journal'),
    journalWal: vscode.l10n.t('Write-ahead log (WAL)'),
    journalRollback: vscode.l10n.t('Rollback journal'),
    userVersion: vscode.l10n.t('User version'),
    applicationId: vscode.l10n.t('Application ID'),
    writtenBy: vscode.l10n.t('Last written by'),
  };
}
