import { open, rm } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ExportFormat, ExportSource } from '../shared/protocol';
import type { DatabaseClient } from './database/client';
import type { DatabaseDocument } from './databaseDocument';

/** Each chunk is about a megabyte of text, or what 200 ms read, whichever comes first. */
const CHUNK_BYTES = 1024 * 1024;
const CHUNK_MS = 200;

export type ExportConnection = Pick<DatabaseClient, 'exportStart' | 'exportStep' | 'dispose'>;

/**
 * Writes rows to `file` as the worker reads them, a chunk at a time, so memory stays flat however
 * many there are (D-023). Stopped, or failed, the part written is removed. Returns the rows
 * written, or undefined when stopped.
 */
export async function writeExport(
  { connection, opened }: { connection: ExportConnection; opened: Promise<void> },
  source: ExportSource,
  format: ExportFormat,
  file: string,
  onRows: (rows: number) => void,
  stopped: () => boolean,
): Promise<number | undefined> {
  const handle = await open(file, 'w');
  let rows = 0;
  let done = false;
  try {
    await opened;
    await connection.exportStart(source, format);
    while (!done && !stopped()) {
      const chunk = await connection.exportStep(CHUNK_BYTES, CHUNK_MS);
      if (chunk.text) await handle.write(chunk.text);
      rows = chunk.rows;
      done = chunk.done;
      onRows(rows);
    }
  } finally {
    connection.dispose();
    await handle.close();
    if (!done) await rm(file, { force: true });
  }
  return done ? rows : undefined;
}

/** A name for a file, with what file names can't hold replaced. */
const fileName = (name: string) =>
  [...name]
    .map((c) => (c < ' ' || '\\/:*?"<>|'.includes(c) ? '_' : c))
    .join('')
    .trim() || 'rows';

const samePath = (a: string, b: string) =>
  process.platform === 'win32'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);

/**
 * Export Rows…: asks where to write the rows, as CSV or JSON by the file's extension, then
 * writes them with progress in a notification that can stop it.
 */
export async function exportToFile(
  document: DatabaseDocument,
  source: ExportSource,
  name: string,
): Promise<void> {
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(document.uri, '..', `${fileName(name)}.csv`),
    filters: { CSV: ['csv'], JSON: ['json'] },
    saveLabel: vscode.l10n.t('Export'),
    title: vscode.l10n.t('Export Rows'),
  });
  if (!target) return;
  const database = document.uri.fsPath;
  // The one file never to write over, nor its journal: the database open here.
  if (
    ['', '-wal', '-shm', '-journal'].some((end) => samePath(`${database}${end}`, target.fsPath))
  ) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("The rows can't be exported over the database itself."),
    );
    return;
  }
  const format: ExportFormat = target.path.toLowerCase().endsWith('.json') ? 'json' : 'csv';
  const shownName = path.basename(target.fsPath);
  const count = (rows: number) => new Intl.NumberFormat(vscode.env.language).format(rows);
  let cancelled = false;
  let rows: number | undefined;
  try {
    rows = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Exporting to {0}', shownName),
        cancellable: true,
      },
      (progress, token) => {
        const connection = document.queryConnection();
        // A chunk SQLite is stuck in, like the first rows of a big sort, ends with its worker.
        token.onCancellationRequested(() => {
          cancelled = true;
          connection.connection.dispose();
        });
        return writeExport(
          connection,
          source,
          format,
          target.fsPath,
          (written) => progress.report({ message: vscode.l10n.t('{0} rows', count(written)) }),
          () => token.isCancellationRequested,
        );
      },
    );
  } catch (error) {
    if (cancelled) return;
    const detail = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(
      vscode.l10n.t("The rows couldn't be exported: {0}", detail),
    );
    return;
  }
  if (rows === undefined) return;
  const openFile = vscode.l10n.t('Open');
  const showFolder = vscode.l10n.t('Show in Folder');
  const choice = await vscode.window.showInformationMessage(
    vscode.l10n.t('Exported {0} rows to {1}.', count(rows), shownName),
    openFile,
    showFolder,
  );
  if (choice === openFile) await vscode.commands.executeCommand('vscode.open', target);
  if (choice === showFolder) await vscode.commands.executeCommand('revealFileInOS', target);
}
