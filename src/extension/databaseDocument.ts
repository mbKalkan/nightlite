import type * as vscode from 'vscode';
import type {
  CopyRange,
  DatabaseHeader,
  ObjectInfo,
  RowPage,
  SchemaObject,
} from '../shared/protocol';
import { DatabaseClient } from './database/client';
import type { CopiedText } from './database/rows';
import { connectionTarget } from './database/target';
import type { DatabaseBackend } from './requests';

/**
 * An open database file, shared by every editor showing it. One worker reads the schema and
 * rows; counting, which can take seconds on big tables, has a worker of its own so it never
 * holds up scrolling, and is stopped by ending that worker.
 */
export class DatabaseDocument implements vscode.CustomDocument, DatabaseBackend {
  /** The header as last read, set by the first editor that loads the file. */
  header: DatabaseHeader | undefined;
  private reader: Promise<DatabaseClient> | undefined;
  private readerClient: DatabaseClient | undefined;
  private counter: { client: DatabaseClient; name: string } | undefined;
  private objects: Promise<SchemaObject[]> | undefined;
  private readonly counts = new Map<string, Promise<number>>();

  constructor(
    readonly uri: vscode.Uri,
    private readonly workerScript: string,
  ) {}

  /** Opens the database on first use and reads its schema once for every editor. */
  schema(header: DatabaseHeader): Promise<SchemaObject[]> {
    this.header = header;
    this.objects ??= this.open().then((client) => client.schema());
    this.objects.catch(() => (this.objects = undefined));
    return this.objects;
  }

  async objectInfo(name: string): Promise<ObjectInfo> {
    return (await this.open()).objectInfo(name);
  }

  async rows(name: string, start: number, count: number, total: number): Promise<RowPage> {
    return (await this.open()).rows(name, start, count, total);
  }

  async copy(name: string, range: CopyRange): Promise<CopiedText> {
    return (await this.open()).copy(name, range);
  }

  count(name: string): Promise<number> {
    let count = this.counts.get(name);
    if (!count) {
      // One count at a time: a new table's count stops the one still running.
      if (this.counter && this.counter.name !== name) {
        this.counter.client.dispose();
        this.counter = undefined;
      }
      const client = (this.counter ??= { client: this.newClient(), name }).client;
      count = client.open(this.target()).then(() => client.count(name));
      count.then(
        () => {
          if (this.counter?.client === client) {
            this.counter = undefined;
            client.dispose();
          }
        },
        () => this.counts.delete(name),
      );
      this.counts.set(name, count);
    }
    return count;
  }

  dispose(): void {
    this.readerClient?.dispose();
    this.counter?.client.dispose();
    this.readerClient = undefined;
    this.counter = undefined;
    this.reader = undefined;
    this.objects = undefined;
    this.counts.clear();
  }

  private open(): Promise<DatabaseClient> {
    this.reader ??= (async () => {
      const client = this.newClient();
      this.readerClient = client;
      try {
        await client.open(this.target());
        return client;
      } catch (error) {
        // Let a later attempt, after the file changes, start over.
        this.dispose();
        throw error;
      }
    })();
    return this.reader;
  }

  private newClient(): DatabaseClient {
    return new DatabaseClient(this.workerScript);
  }

  private target(): string {
    return connectionTarget(this.uri.fsPath, this.header?.wal ?? false);
  }
}
