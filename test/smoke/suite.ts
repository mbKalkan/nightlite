// Runs inside a real VS Code instance (see scripts/smoke.mjs).
import * as assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as vscode from 'vscode';
import { DatabaseClient } from '../../src/extension/database/client';
import { connectionTarget } from '../../src/extension/database/target';
import { DatabaseDocument } from '../../src/extension/databaseDocument';
import { writeExport } from '../../src/extension/exportFile';
import { watchDatabase } from '../../src/extension/fileWatcher';
import { QuerySession } from '../../src/extension/querySession';
import type { HostToWebviewMessage } from '../../src/shared/protocol';

const EXTENSION_ID = 'MBKDevStudio.nightlite';
const VIEW_TYPE = 'nightlite.viewer';
const FIXTURES = path.resolve(__dirname, '../../test/fixtures');
const WORKER = path.resolve(__dirname, '../../dist/databaseWorker.js');

async function waitFor<T>(probe: () => T | undefined, timeoutMs = 30_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Opens a fixture the way a click in the Explorer does and returns the editor tab's input. */
async function open(name: string): Promise<vscode.TabInputCustom> {
  const file = path.isAbsolute(name) ? name : path.join(FIXTURES, name);
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
  return waitFor(() => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    return tab?.input instanceof vscode.TabInputCustom &&
      tab.input.uri.path.endsWith(`/${path.basename(file)}`)
      ? tab.input
      : undefined;
  });
}

const tests: Record<string, () => Promise<void>> = {
  async 'opens SQLite databases in the viewer by default'() {
    const input = await open('sample.sqlite');
    assert.equal(input.viewType, VIEW_TYPE);
    assert.ok(vscode.extensions.getExtension(EXTENSION_ID)?.isActive);
  },

  async 'opens MBTiles and GeoPackage files in the viewer by default'() {
    assert.equal((await open('sample.mbtiles')).viewType, VIEW_TYPE);
    assert.equal((await open('sample.gpkg')).viewType, VIEW_TYPE);
  },

  async 'opens .db files in the viewer, and notices when one changes'() {
    // A copy of its own, outside any workspace folder, as files are opened from anywhere.
    const folder = mkdtempSync(path.join(tmpdir(), 'nightlite-smoke-db-'));
    const file = path.join(folder, 'copy.db');
    copyFileSync(path.join(FIXTURES, 'sample.sqlite'), file);
    let changes = 0;
    const watcher = watchDatabase(vscode.Uri.file(file), () => changes++, 100);
    try {
      assert.equal((await open(file)).viewType, VIEW_TYPE);
      // Give the watcher a moment to start before the file changes.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const writer = new DatabaseSync(file);
      writer.exec('CREATE TABLE added (x)');
      writer.close();
      await waitFor(() => (changes > 0 ? true : undefined), 15_000);

      // A reset drops what was read, so the next count sees the change.
      const document = new DatabaseDocument(vscode.Uri.file(file), WORKER);
      try {
        assert.equal(await document.count('events'), 5000);
        const more = new DatabaseSync(file);
        more.exec("INSERT INTO events (at) VALUES ('2026-01-01')");
        more.close();
        let told = false;
        document.onReset(() => (told = true));
        document.reset();
        assert.ok(told);
        assert.equal(document.generation, 1);
        assert.equal(await document.count('events'), 5001);
      } finally {
        document.dispose();
      }
    } finally {
      watcher.dispose();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      try {
        rmSync(folder, { recursive: true, force: true });
      } catch {
        // The viewer's worker may still hold the file for a moment on Windows.
      }
    }
  },

  async 'reads the schema in a worker thread of this VS Code'() {
    const client = new DatabaseClient(WORKER);
    try {
      await client.open(path.join(FIXTURES, 'sample.sqlite'));
      const names = (await client.schema()).map((object) => object.name);
      assert.ok(names.includes('albums') && names.includes('album_list'), names.join(', '));
      // GDAL's GeoPackage views quote strings with double quotes; this VS Code's SQLite reads them.
      await client.open(path.join(FIXTURES, 'sample.gpkg'));
      const view = await client.rows('st_geometry_columns', 0, 10, 10);
      assert.equal(view.rows[0]?.[2], 'ST_POINT');
      await client.open(path.join(FIXTURES, 'sample.sqlite'));
      const details = await client.objectDetails('albums');
      assert.equal(details.columns?.length, 8);
      assert.deepEqual(details.foreignKeys?.[0]?.from, ['artist_id']);
    } finally {
      client.dispose();
    }
  },

  async 'reads rows and counts them in worker threads'() {
    const client = new DatabaseClient(WORKER);
    try {
      await client.open(path.join(FIXTURES, 'sample.sqlite'));
      const info = await client.objectInfo('events');
      assert.equal(info.estimate, 5000);
      const page = await client.rows('events', 4900, 100, 5000);
      assert.equal(page.rows.length, 100);
      assert.equal(page.rowids?.[99], '5000');
      assert.equal(await client.count('events'), 5000);
      const copied = await client.copy('events', {
        start: 4998,
        count: null,
        total: 5000,
        firstColumn: 0,
        lastColumn: 0,
      });
      assert.deepEqual(copied, {
        text: '4999\n5000',
        rows: 2,
        cells: 2,
        stopped: false,
        cut: false,
      });
      const cell = await client.cell('events', 4999, 5000, 0, '5000');
      assert.deepEqual(cell, { type: 'i', text: '5000', length: 4 });
    } finally {
      client.dispose();
    }
  },

  async 'counts every table for the overview in the background'() {
    const document = new DatabaseDocument(
      vscode.Uri.file(path.join(FIXTURES, 'sample.sqlite')),
      WORKER,
    );
    try {
      const sizes = new Map<string, unknown>();
      await document.tableSummaries(['albums', 'events'], (name, summary) =>
        sizes.set(name, summary),
      );
      assert.deepEqual(Object.fromEntries(sizes), {
        albums: { rows: 5, columns: 8 },
        events: { rows: 5000, columns: 4 },
      });
      // Opening a table counted there needs no second count.
      assert.equal(await document.count('events'), 5000);
    } finally {
      document.dispose();
    }
  },

  async 'counts tiles by zoom level in the background, and stops for a table count'() {
    const document = new DatabaseDocument(
      vscode.Uri.file(path.join(FIXTURES, 'sample.mbtiles')),
      WORKER,
    );
    try {
      const summary = await document.mbtiles();
      assert.equal(summary.tiles, 'table');
      assert.ok(summary.metadata?.some(([name]) => name === 'json'));
      const counts: number[] = [];
      let range: unknown;
      await document.zoomCounts(
        [],
        (found) => (range = found),
        (zoom, count) => (counts[zoom] = count),
      );
      assert.deepEqual(range, { min: 0, max: 2 });
      assert.deepEqual(counts, [1, 4, 16]);

      // A table's count takes the background worker; the zoom counts give way.
      const zooms = document.zoomCounts(
        [],
        () => {},
        () => {},
      );
      const tiles = document.count('tiles');
      await assert.rejects(zooms);
      assert.equal(await tiles, 21);
    } finally {
      document.dispose();
    }
  },

  async 'runs a query on a worker of its own, and stops one'() {
    const document = new DatabaseDocument(
      vscode.Uri.file(path.join(FIXTURES, 'sample.sqlite')),
      WORKER,
    );
    const messages: HostToWebviewMessage[] = [];
    const session = new QuerySession(
      () => document.queryConnection(),
      async (message) => messages.push(message),
      async () => {},
    );
    const last = <T extends HostToWebviewMessage['type']>(type: T) =>
      messages.filter((message) => message.type === type).at(-1) as
        Extract<HostToWebviewMessage, { type: T }> | undefined;
    try {
      await session.answer({
        type: 'runQuery',
        run: 1,
        sql: 'SELECT id FROM events ORDER BY id DESC',
      });
      assert.deepEqual(
        { ...last('queryResult'), ms: 0 },
        {
          type: 'queryResult',
          run: 1,
          info: {
            name: '',
            columns: [
              {
                name: 'id',
                type: 'INTEGER',
                notNull: false,
                defaultValue: null,
                primaryKey: 0,
                generated: false,
              },
            ],
            hasRowid: false,
            estimate: null,
          },
          rows: 5000,
          end: 'done',
          ms: 0,
        },
      );
      await session.answer({
        type: 'rows',
        request: 1,
        name: '',
        query: 1,
        start: 0,
        count: 2,
        total: 5000,
      });
      assert.deepEqual(last('rowPage')?.page.rows, [[5000], [4999]]);

      // Rows that come slowly: stopping keeps the ones read.
      const slow = session.answer({
        type: 'runQuery',
        run: 2,
        sql:
          'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) ' +
          'SELECT i FROM n WHERE (SELECT count(*) FROM events WHERE amount > i % 7) >= 0',
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      await session.answer({ type: 'stopQuery', run: 2 });
      await slow;
      const stopped = last('queryResult');
      assert.equal(stopped?.run, 2);
      assert.equal(stopped?.end, 'stopped');
      assert.ok(stopped.rows > 0 && stopped.rows < 100_000, `${stopped.rows} rows`);

      // One row that takes SQLite ages: stopping ends the worker.
      const stuck = session.answer({
        type: 'runQuery',
        run: 3,
        sql: 'SELECT count(*) FROM events a, events b, events c',
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      await session.answer({ type: 'stopQuery', run: 3 });
      await stuck;
      assert.deepEqual(last('queryError'), {
        type: 'queryError',
        run: 3,
        reason: 'stopped',
        detail: '',
      });

      // A table's rows sorted and filtered, the same way.
      await session.answer({
        type: 'runView',
        run: 4,
        name: 'events',
        view: { order: { column: 0, descending: true }, search: '', filters: ['<=10'] },
      });
      assert.equal(last('queryResult')?.rows, 10);
      await session.answer({
        type: 'rows',
        request: 2,
        name: 'events',
        query: 4,
        start: 0,
        count: 3,
        total: 10,
      });
      assert.deepEqual(last('rowPage')?.page.rowids, ['10', '9', '8']);
    } finally {
      session.dispose();
      document.dispose();
    }
  },

  async 'exports rows to a file as they are read, and stops an export'() {
    const document = new DatabaseDocument(
      vscode.Uri.file(path.join(FIXTURES, 'sample.sqlite')),
      WORKER,
    );
    const folder = mkdtempSync(path.join(tmpdir(), 'nightlite-export-'));
    try {
      const csv = path.join(folder, 'events.csv');
      const plain = { order: null, search: '', filters: [] };
      const rows = await writeExport(
        document.queryConnection(),
        { table: 'events', view: plain },
        'csv',
        csv,
        () => {},
        () => false,
      );
      assert.equal(rows, 5000);
      const lines = readFileSync(csv, 'utf8').split('\r\n');
      assert.equal(lines[0], 'id,at,kind,amount');
      assert.equal(lines.length, 5002);

      // Stopped after the first chunk, the part written goes.
      const json = path.join(folder, 'endless.json');
      let chunks = 0;
      const stopped = await writeExport(
        document.queryConnection(),
        { sql: 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT i FROM n' },
        'json',
        json,
        () => chunks++,
        () => chunks > 0,
      );
      assert.equal(stopped, undefined);
      assert.equal(existsSync(json), false);
    } finally {
      document.dispose();
      rmSync(folder, { recursive: true, force: true });
    }
  },

  async 'opens a WAL database without creating files next to it'() {
    const file = path.join(FIXTURES, 'wal.sqlite');
    const client = new DatabaseClient(WORKER);
    try {
      await client.open(connectionTarget(file, true));
      assert.deepEqual(
        (await client.schema()).map((object) => object.name),
        ['notes'],
      );
    } finally {
      client.dispose();
    }
    assert.equal(existsSync(`${file}-wal`), false);
    assert.equal(existsSync(`${file}-shm`), false);
  },

  async 'registers its commands'() {
    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      'nightlite.goToTable',
      'nightlite.openQuery',
      'nightlite.copy',
      'nightlite.copyAsMarkdown',
      'nightlite.sortAscending',
      'nightlite.sortDescending',
      'nightlite.clearSort',
      'nightlite.exportRows',
    ]) {
      assert.ok(commands.includes(command), command);
    }
  },

  async 'opens a file that is not a database without failing'() {
    assert.equal((await open('not-sqlite.sqlite')).viewType, VIEW_TYPE);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  },
};

/** Whether this VS Code's extension host has Node's built-in SQLite (D-003). */
function hasNodeSqlite(): boolean {
  try {
    return process.getBuiltinModule?.('node:sqlite') !== undefined;
  } catch {
    return false;
  }
}

export async function run(): Promise<void> {
  console.log(
    `  VS Code ${vscode.version}, Node ${process.versions.node}, node:sqlite ${hasNodeSqlite() ? 'yes' : 'no'}`,
  );
  const failures: string[] = [];
  for (const [name, test] of Object.entries(tests)) {
    try {
      await test();
      console.log(`  ✓ ${name}`);
    } catch (error) {
      console.log(`  ✗ ${name}`);
      failures.push(`${name}: ${error instanceof Error ? error.stack : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} smoke test(s) failed:\n${failures.join('\n')}`);
  }
}
