// Messages between the extension host and the worker thread that owns a database connection.

import type { CopyRange } from '../../shared/protocol';
import type { MetadataChange } from './metadataWrite';

export type WorkerCall =
  | { type: 'open'; target: string }
  | { type: 'schema' }
  | { type: 'objectInfo'; name: string }
  | { type: 'rows'; name: string; start: number; count: number; total: number }
  | { type: 'count'; name: string }
  | { type: 'copy'; name: string; range: CopyRange }
  | { type: 'cell'; name: string; row: number; total: number; column: number; rowid?: string }
  | { type: 'objectDetails'; name: string }
  | { type: 'tableSummary'; name: string }
  | { type: 'mbtiles' }
  | { type: 'zoomRange' }
  | { type: 'zoomCount'; zoom: number }
  | { type: 'tilePage'; zoom: number; start: number; count: number; total: number }
  | { type: 'locateTile'; zoom: number; column: number; row: number; total: number }
  | { type: 'tile'; zoom: number; column: number; row: number }
  | { type: 'storedTile'; zoom: number; column: number; row: number }
  | { type: 'metadataRows' }
  /** Writes metadata changes into the file at `path`, on a connection of its own. */
  | { type: 'writeMetadata'; path: string; changes: MetadataChange[] }
  /** A statement from the query page, on a worker of its own (D-021). */
  | { type: 'queryStart'; sql: string }
  | { type: 'queryStep'; ms: number }
  | { type: 'queryStop' }
  | { type: 'queryRows'; start: number; count: number }
  | { type: 'queryCopy'; range: CopyRange }
  | { type: 'queryCell'; row: number; column: number };

export type WorkerRequest = WorkerCall & { id: number };

/** An error SQLite raised: `code` is its result code, 0 when the error didn't come from SQLite. */
export interface WorkerFailure {
  code: number;
  message: string;
}

export type WorkerResponse = { id: number; result: unknown } | { id: number; error: WorkerFailure };
