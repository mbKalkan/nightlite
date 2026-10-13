import { Worker } from 'node:worker_threads';
import type { CopyRange, ObjectInfo, RowPage, SchemaObject } from '../../shared/protocol';
import type { WorkerCall, WorkerFailure, WorkerResponse } from './messages';
import type { CopiedText } from './rows';

/** An error from the database worker, with SQLite's result code when SQLite raised it. */
export class DatabaseFailure extends Error {
  readonly code: number;

  constructor(failure: WorkerFailure) {
    super(failure.message);
    this.code = failure.code;
  }
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/** One database connection in its own worker thread, started on first use. */
export class DatabaseClient {
  private worker: Worker | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  /** `script` is the bundled worker (dist/databaseWorker.js). */
  constructor(private readonly script: string) {}

  open(target: string): Promise<void> {
    return this.call({ type: 'open', target }) as Promise<void>;
  }

  schema(): Promise<SchemaObject[]> {
    return this.call({ type: 'schema' }) as Promise<SchemaObject[]>;
  }

  objectInfo(name: string): Promise<ObjectInfo> {
    return this.call({ type: 'objectInfo', name }) as Promise<ObjectInfo>;
  }

  rows(name: string, start: number, count: number, total: number): Promise<RowPage> {
    return this.call({ type: 'rows', name, start, count, total }) as Promise<RowPage>;
  }

  count(name: string): Promise<number> {
    return this.call({ type: 'count', name }) as Promise<number>;
  }

  copy(name: string, range: CopyRange): Promise<CopiedText> {
    return this.call({ type: 'copy', name, range }) as Promise<CopiedText>;
  }

  dispose(): void {
    const worker = this.worker;
    this.worker = undefined;
    this.failAll(new Error('The database was closed'));
    void worker?.terminate();
  }

  private call(call: WorkerCall): Promise<unknown> {
    const worker = (this.worker ??= this.start());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...call, id });
    });
  }

  private start(): Worker {
    const worker = new Worker(this.script);
    worker.on('message', (response: WorkerResponse) => {
      const pending = this.pending.get(response.id);
      this.pending.delete(response.id);
      if ('error' in response) {
        pending?.reject(new DatabaseFailure(response.error));
      } else {
        pending?.resolve(response.result);
      }
    });
    worker.on('error', (error) => this.failAll(error));
    worker.on('exit', () => {
      if (this.worker === worker) {
        this.worker = undefined;
        this.failAll(new Error('The database worker stopped'));
      }
    });
    return worker;
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
