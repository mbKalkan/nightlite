// Runs in a worker thread. node:sqlite is synchronous, so a long query here keeps the
// extension host responsive; cancelling one means terminating this thread (D-003).
import { DatabaseSync } from 'node:sqlite';
import { parentPort } from 'node:worker_threads';
import { readDetails } from './details';
import { readMbtiles, zoomCount, zoomRange } from './mbtiles';
import type { WorkerCall, WorkerRequest, WorkerResponse } from './messages';
import { TableReader } from './rows';
import { readSchema } from './schema';
import { READ_OPTIONS } from './target';
import { TileLister, readStoredTile, readTile } from './tiles';

let db: DatabaseSync | undefined;
const readers = new Map<string, TableReader>();
const listers = new Map<number, TileLister>();

function handle(call: WorkerCall): unknown {
  switch (call.type) {
    case 'open':
      readers.clear();
      listers.clear();
      db?.close();
      // Read-only: SQLite refuses every write, and load_extension stays off by default.
      db = new DatabaseSync(call.target, READ_OPTIONS);
      return null;
    case 'schema':
      return readSchema(connection());
    case 'objectInfo':
      return reader(call.name).info;
    case 'rows':
      return reader(call.name).page(call.start, call.count, call.total);
    case 'count':
      return reader(call.name).count();
    case 'copy':
      return reader(call.name).copy(call.range);
    case 'cell':
      return reader(call.name).cell(call.row, call.total, call.column, call.rowid);
    case 'objectDetails':
      return readDetails(connection(), call.name);
    case 'tableSummary': {
      const table = reader(call.name);
      return { rows: table.count(), columns: table.info.columns.length };
    }
    case 'mbtiles':
      return readMbtiles(connection());
    case 'zoomRange':
      return zoomRange(connection());
    case 'zoomCount':
      return zoomCount(connection(), call.zoom);
    case 'tilePage':
      return lister(call.zoom).page(call.start, call.count, call.total);
    case 'locateTile':
      return lister(call.zoom).locate(call.column, call.row, call.total);
    case 'tile':
      return readTile(connection(), call.zoom, call.column, call.row);
    case 'storedTile':
      return readStoredTile(connection(), call.zoom, call.column, call.row);
  }
}

function connection(): DatabaseSync {
  if (!db) {
    throw new Error('The database is not open');
  }
  return db;
}

function reader(name: string): TableReader {
  let found = readers.get(name);
  if (!found) {
    found = new TableReader(connection(), name);
    readers.set(name, found);
  }
  return found;
}

function lister(zoom: number): TileLister {
  let found = listers.get(zoom);
  if (!found) {
    found = new TileLister(connection(), zoom);
    listers.set(zoom, found);
  }
  return found;
}

parentPort?.on('message', (request: WorkerRequest) => {
  let response: WorkerResponse;
  try {
    response = { id: request.id, result: handle(request) };
  } catch (error) {
    const { errcode, message } = error as { errcode?: number; message?: string };
    response = { id: request.id, error: { code: errcode ?? 0, message: message ?? String(error) } };
  }
  parentPort?.postMessage(response);
});
