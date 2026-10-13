// Runs inside a real VS Code instance (see scripts/smoke.mjs).
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'MBKDevStudio.nightlite';
const VIEW_TYPE = 'nightlite.viewer';
const FIXTURES = path.resolve(__dirname, '../../test/fixtures');

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
