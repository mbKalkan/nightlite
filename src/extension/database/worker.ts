// Runs in a worker thread. node:sqlite is synchronous, so a long query here keeps the
// extension host responsive; cancelling one means terminating this thread (D-003).
import { DatabaseSync } from 'node:sqlite';
import { parentPort } from 'node:worker_threads';
import { readDetails } from './details';
import { readMbtiles, readMetadataRows, zoomCount, zoomRange } from './mbtiles';
import { writeMetadata } from './metadataWrite';
import { ExportRun, exportStatement } from './exportRows';
import type { WorkerCall, WorkerRequest, WorkerResponse } from './messages';
import { QueryRun, type ResultRows } from './query';
import { TableReader } from './rows';
import { viewRows } from './sortedRows';
import { readSchema } from './schema';
import { READ_OPTIONS } from './target';
import { TileLister, readStoredTile, readTile } from './tiles';

let db: DatabaseSync | undefined;
const readers = new Map<string, TableReader>();
const listers = new Map<number, TileLister>();
/** The query or table view this worker was started for, with its rows. */
let query: ResultRows | undefined;
let exporting: ExportRun | undefined;

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
    case 'metadataRows':
      return readMetadataRows(connection());
    case 'writeMetadata':
      writeMetadata(call.path, call.changes);
      return null;
    case 'storedTile':
      return readStoredTile(connection(), call.zoom, call.column, call.row);
    case 'queryStart':
      // On top of the read-only connection: SQLite refuses even temporary tables (D-021).
      connection().exec('PRAGMA query_only = ON');
      query = new QueryRun(connection(), call.sql);
      return query.info;
    case 'exportStart':
      connection().exec('PRAGMA query_only = ON; PRAGMA cache_size = -131072; PRAGMA threads = 4');
      exporting = new ExportRun(connection(), exportStatement(call.source, reader), call.format);
      return null;
    case 'exportStep':
      if (!exporting) throw new Error('No export has started');
      return exporting.next(call.bytes, call.ms);
    case 'viewStart':
      // A sort needs room: SQLite sorts in memory up to the page cache, then in temporary files
      // (never beside the database). With the default 2 MB, 10 M rows took 108 s; with 128 MB, 11 s.
      connection().exec('PRAGMA query_only = ON; PRAGMA cache_size = -131072; PRAGMA threads = 4');
      query = viewRows(connection(), reader(call.name), call.view);
      return query.info;
    case 'queryStep':
      return running().step(call.ms);
    case 'queryStop':
      return running().stop();
    case 'queryRows':
      return running().page(call.start, call.count);
    case 'queryCopy':
      return running().copy(call.range);
    case 'queryCell':
      return running().cell(call.row, call.column);
  }
}

function connection(): DatabaseSync {
  if (!db) {
    throw new Error('The database is not open');
  }
  return db;
}

function running(): ResultRows {
  if (!query) {
    throw new Error('No query has run');
  }
  return query;
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
