import type * as vscode from 'vscode';
import type { DatabaseError, DatabaseHeader, SchemaObject } from '../shared/protocol';
import { DatabaseClient, DatabaseFailure } from './database/client';
import { connectionTarget } from './database/target';

/** An open database file: one worker connection shared by every editor showing it. */
export class DatabaseDocument implements vscode.CustomDocument {
  /** The header as last read, set by the first editor that loads the file. */
  header: DatabaseHeader | undefined;
  private client: DatabaseClient | undefined;
  private opening: Promise<DatabaseClient> | undefined;
  private objects: Promise<SchemaObject[]> | undefined;

  constructor(
    readonly uri: vscode.Uri,
    private readonly workerScript: string,
  ) {}

  /** Opens the database on first use and reads its schema once for every editor. */
  schema(header: DatabaseHeader): Promise<SchemaObject[]> {
    this.header = header;
    this.objects ??= this.open(header).then((client) => client.schema());
    this.objects.catch(() => (this.objects = undefined));
    return this.objects;
  }

  dispose(): void {
    this.client?.dispose();
    this.client = undefined;
    this.opening = undefined;
    this.objects = undefined;
  }

  private open(header: DatabaseHeader): Promise<DatabaseClient> {
    this.opening ??= (async () => {
      const client = new DatabaseClient(this.workerScript);
      this.client = client;
      try {
        await client.open(connectionTarget(this.uri.fsPath, header.wal));
        return client;
      } catch (error) {
        // Let a later attempt, after the file changes, start over.
        this.dispose();
        throw error;
      }
    })();
    return this.opening;
  }
}

/** SQLite's primary result codes that the viewer explains in its own words. */
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_CANTOPEN = 14;
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

export function classifyDatabaseError(error: unknown): { error: DatabaseError; detail: string } {
  const detail = error instanceof Error ? error.message : String(error);
  const code = error instanceof DatabaseFailure ? error.code & 0xff : 0;
  switch (code) {
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
