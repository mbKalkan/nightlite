// Builds the smoke test suite and runs it inside a downloaded copy of VS Code.
// VSCODE_VERSION picks the version: `stable` by default, or the lowest one package.json supports.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';
import * as esbuild from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const suite = resolve(root, 'out/smoke/suite.js');

await esbuild.build({
  entryPoints: [resolve(root, 'test/smoke/suite.ts')],
  outfile: suite,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['vscode'],
  logLevel: 'warning',
});

// When launched from a terminal inside VS Code this is set and would make Code.exe behave as Node.
delete process.env.ELECTRON_RUN_AS_NODE;

// A fresh profile each run, so editors VS Code restores from an earlier run can't get in the way.
const userData = mkdtempSync(join(tmpdir(), 'nightlite-smoke-'));
try {
  await runTests({
    version: process.env.VSCODE_VERSION ?? 'stable',
    extensionDevelopmentPath: root,
    extensionTestsPath: suite,
    launchArgs: [
      resolve(root, 'test/fixtures'),
      '--disable-extensions',
      '--skip-welcome',
      '--user-data-dir',
      userData,
    ],
  });
} finally {
  rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
