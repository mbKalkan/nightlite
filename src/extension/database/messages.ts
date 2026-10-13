// Messages between the extension host and the worker thread that owns a database connection.

import type { CopyRange } from '../../shared/protocol';

export type WorkerCall =
  | { type: 'open'; target: string }
  | { type: 'schema' }
  | { type: 'objectInfo'; name: string }
  | { type: 'rows'; name: string; start: number; count: number; total: number }
  | { type: 'count'; name: string }
  | { type: 'copy'; name: string; range: CopyRange }
  | { type: 'cell'; name: string; row: number; total: number; column: number; rowid?: string }
  | { type: 'mbtiles' }
  | { type: 'zoomRange' }
  | { type: 'zoomCount'; zoom: number };

export type WorkerRequest = WorkerCall & { id: number };

/** An error SQLite raised: `code` is its result code, 0 when the error didn't come from SQLite. */
export interface WorkerFailure {
  code: number;
  message: string;
}

export type WorkerResponse = { id: number; result: unknown } | { id: number; error: WorkerFailure };
