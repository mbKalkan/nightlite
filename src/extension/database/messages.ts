// Messages between the extension host and the worker thread that owns a database connection.

export type WorkerCall = { type: 'open'; target: string } | { type: 'schema' };

export type WorkerRequest = WorkerCall & { id: number };

/** An error SQLite raised: `code` is its result code, 0 when the error didn't come from SQLite. */
export interface WorkerFailure {
  code: number;
  message: string;
}

export type WorkerResponse = { id: number; result: unknown } | { id: number; error: WorkerFailure };
