// Bundles the extension host (Node, CommonJS) and the webview (browser, ESM with lazy chunks).
import { rmSync } from 'node:fs';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'linked',
  logLevel: 'info',
  legalComments: 'linked',
};

/** @type {import('esbuild').BuildOptions} */
const extension = {
  ...shared,
  entryPoints: ['src/extension/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['vscode'],
};

/**
 * Each open database gets a worker thread running this, so queries never block VS Code.
 * @type {import('esbuild').BuildOptions}
 */
const databaseWorker = {
  ...extension,
  entryPoints: ['src/extension/database/worker.ts'],
  outfile: 'dist/databaseWorker.js',
};

/** @type {import('esbuild').BuildOptions} */
const webview = {
  ...shared,
  entryPoints: ['src/webview/main.ts'],
  outdir: 'dist/webview',
  platform: 'browser',
  format: 'esm',
  splitting: true,
  target: 'chrome120',
  chunkNames: 'chunks/[name]-[hash]',
};

if (watch) {
  const contexts = await Promise.all(
    [extension, databaseWorker, webview].map((options) => esbuild.context(options)),
  );
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  rmSync('dist', { recursive: true, force: true });
  await Promise.all([extension, databaseWorker, webview].map((options) => esbuild.build(options)));
}
