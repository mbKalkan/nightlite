import type * as vscode from 'vscode';
import type {
  CopyRange,
  DatabaseHeader,
  FullCell,
  MbtilesSummary,
  ObjectDetails,
  ObjectInfo,
  RowPage,
  SchemaObject,
  ZoomRange,
} from '../shared/protocol';
import { DatabaseClient } from './database/client';
import type { CopiedText } from './database/rows';
import { connectionTarget } from './database/target';
import { zoomLevels } from '../shared/mbtiles';
import type { DatabaseBackend } from './requests';

/**
 * An open database file, shared by every editor showing it. One worker reads the schema and
 * rows; counting, which can take seconds on big tables, runs on a worker of its own so it
 * never holds up scrolling, one count at a time, and is stopped by ending that worker.
 */
export class DatabaseDocument implements vscode.CustomDocument, DatabaseBackend {
  /** The header as last read, set by the first editor that loads the file. */
  header: DatabaseHeader | undefined;
  private reader: Promise<DatabaseClient> | undefined;
  private readerClient: DatabaseClient | undefined;
  private background: { client: DatabaseClient; key: string; job: Promise<unknown> } | undefined;
  private zoomJobs = 0;
  /** Counts resets: answers worked out before one are about the file as it was. */
  generation = 0;
  private readonly resetListeners = new Set<() => void>();
  private readonly owned: { dispose(): void }[] = [];
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

  async cell(
    name: string,
    row: number,
    total: number,
    column: number,
    rowid?: string,
  ): Promise<FullCell> {
    return (await this.open()).cell(name, row, total, column, rowid);
  }

  count(name: string): Promise<number> {
    let count = this.counts.get(name);
    if (!count) {
      count = this.inBackground(`count:${name}`, (client) => client.count(name));
      count.catch(() => this.counts.delete(name));
      this.counts.set(name, count);
    }
    return count;
  }

  async objectDetails(name: string): Promise<ObjectDetails> {
    return (await this.open()).objectDetails(name);
  }

  async mbtiles(): Promise<MbtilesSummary> {
    return (await this.open()).mbtiles();
  }

  /** Counts tiles by zoom level in the background, each level as it's counted. */
  zoomCounts(
    skip: number[],
    onRange: (range: ZoomRange | null) => void,
    onCount: (zoom: number, count: number) => void,
  ): Promise<void> {
    // Each request starts over, so a reopened view hears every level it asks for.
    return this.inBackground(`zooms:${++this.zoomJobs}`, async (client) => {
      const range = await client.zoomRange();
      onRange(range);
      if (!range) return;
      for (const zoom of zoomLevels(range)) {
        if (!skip.includes(zoom)) onCount(zoom, await client.zoomCount(zoom));
      }
    });
  }

  /**
   * The file changed on disk: drops the connections and everything read through them, so the
   * next question opens the file afresh, and tells the editors to load it again.
   */
  reset(): void {
    this.close();
    this.generation++;
    for (const listener of this.resetListeners) listener();
  }

  onReset(listener: () => void): { dispose(): void } {
    this.resetListeners.add(listener);
    return { dispose: () => this.resetListeners.delete(listener) };
  }

  /** Something to dispose of with the document, like its file watcher. */
  own(disposable: { dispose(): void }): void {
    this.owned.push(disposable);
  }

  dispose(): void {
    this.close();
    this.owned.forEach((disposable) => disposable.dispose());
    this.owned.length = 0;
    this.resetListeners.clear();
  }

  private close(): void {
    this.readerClient?.dispose();
    this.background?.client.dispose();
    this.readerClient = undefined;
    this.background = undefined;
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
        this.close();
        throw error;
      }
    })();
    return this.reader;
  }

  /**
   * Runs a slow job on a worker of its own, one job at a time: another job ends the running
   * one's worker. The same job asked for again joins the running one.
   */
  private inBackground<T>(key: string, job: (client: DatabaseClient) => Promise<T>): Promise<T> {
    if (this.background?.key === key) return this.background.job as Promise<T>;
    this.background?.client.dispose();
    const client = this.newClient();
    const running = client.open(this.target()).then(() => job(client));
    this.background = { client, key, job: running };
    const finish = () => {
      if (this.background?.client === client) {
        this.background = undefined;
        client.dispose();
      }
    };
    running.then(finish, finish);
    return running;
  }

  private newClient(): DatabaseClient {
    return new DatabaseClient(this.workerScript);
  }

  private target(): string {
    return connectionTarget(this.uri.fsPath, this.header?.wal ?? false);
  }
}
