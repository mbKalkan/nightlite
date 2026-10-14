import * as vscode from 'vscode';
import { DatabaseFailure } from './database/client';

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_READONLY = 8;
const SQLITE_FULL = 13;
const SQLITE_CANTOPEN = 14;

/** Why saving metadata failed, in plain words; the changes are always kept to try again. */
export function saveErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  const code = error instanceof DatabaseFailure ? error.code & 0xff : 0;
  switch (code) {
    case SQLITE_BUSY:
    case SQLITE_LOCKED:
      return vscode.l10n.t(
        'Another program is writing to the tileset. Save again in a moment; your changes are kept.',
      );
    case SQLITE_READONLY:
      return vscode.l10n.t(
        "The tileset can't be written to: the file or its disk is read-only. Your changes are kept.",
      );
    case SQLITE_FULL:
      return vscode.l10n.t('The disk is full. Your changes are kept.');
    case SQLITE_CANTOPEN:
      return vscode.l10n.t(
        "The tileset couldn't be opened for writing: it was moved, or you may not have permission. Your changes are kept.",
      );
    default:
      return vscode.l10n.t("The metadata couldn't be saved: {0} Your changes are kept.", detail);
  }
}
