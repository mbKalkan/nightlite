import type { DatabaseError } from '../shared/protocol';
import { DatabaseFailure } from './database/client';

/** SQLite's primary result codes that the viewer explains in its own words. */
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_CORRUPT = 11;
const SQLITE_CANTOPEN = 14;
const SQLITE_NOTADB = 26;

export function classifyDatabaseError(error: unknown): { error: DatabaseError; detail: string } {
  const detail = error instanceof Error ? error.message : String(error);
  // node:sqlite errors carry the code as `errcode`; the worker passes it on as `code`.
  const raw =
    error instanceof DatabaseFailure ? error.code : ((error as { errcode?: number })?.errcode ?? 0);
  switch (raw & 0xff) {
    case SQLITE_CORRUPT:
      return { error: 'damaged', detail };
    case SQLITE_NOTADB:
      return { error: 'notSqlite', detail };
    case SQLITE_BUSY:
    case SQLITE_LOCKED:
      return { error: 'locked', detail };
    case SQLITE_CANTOPEN:
      return { error: 'unreadable', detail };
    default:
      return { error: 'other', detail };
  }
}
