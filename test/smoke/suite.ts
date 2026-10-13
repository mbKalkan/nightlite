// Runs inside a real VS Code instance (see scripts/smoke.mjs).
import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DatabaseClient } from '../../src/extension/database/client';
import { connectionTarget } from '../../src/extension/database/target';

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
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(FIXTURES, name)));
  return waitFor(() => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    return tab?.input instanceof vscode.TabInputCustom && tab.input.uri.path.endsWith(name)
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

  async 'reads the schema in a worker thread of this VS Code'() {
    const client = new DatabaseClient(WORKER);
    try {
      await client.open(path.join(FIXTURES, 'sample.sqlite'));
      const names = (await client.schema()).map((object) => object.name);
      assert.ok(names.includes('albums') && names.includes('album_list'), names.join(', '));
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
    } finally {
      client.dispose();
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

  async 'registers Go to Table'() {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('nightlite.goToTable'));
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
