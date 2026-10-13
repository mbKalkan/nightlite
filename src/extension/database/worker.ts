// Runs in a worker thread. node:sqlite is synchronous, so a long query here keeps the
// extension host responsive; cancelling one means terminating this thread (D-003).
import { DatabaseSync } from 'node:sqlite';
import { parentPort } from 'node:worker_threads';
import type { WorkerCall, WorkerRequest, WorkerResponse } from './messages';
import { readSchema } from './schema';

let db: DatabaseSync | undefined;

function handle(call: WorkerCall): unknown {
  switch (call.type) {
    case 'open':
      db?.close();
      // Read-only: SQLite refuses every write, and load_extension stays off by default.
      db = new DatabaseSync(call.target, { readOnly: true, timeout: 2000 });
      return null;
    case 'schema':
      return readSchema(connection());
  }
}

function connection(): DatabaseSync {
  if (!db) {
    throw new Error('The database is not open');
  }
  return db;
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
