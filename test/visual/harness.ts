import { readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Page } from '@playwright/test';
import { readSchema } from '../../src/extension/database/schema';
import { connectionTarget } from '../../src/extension/database/target';
import { buildWebviewHtml } from '../../src/extension/webviewHtml';
import type { HostToWebviewMessage, ViewerStrings } from '../../src/shared/protocol';
import { HEADER_SIZE, describeFile } from '../../src/shared/sqliteHeader';
import { themes, type ThemeName } from './themes';

interface Theme {
  kind: string;
  classes: readonly string[];
  variables: Record<string, string>;
}

const ORIGIN = 'http://webview.test';

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
};

export const strings: ViewerStrings = {
  errorTitle: "This file can't be displayed",
  errorEmpty: 'The file is empty.',
  errorNotSqlite: "The file isn't a SQLite database, or it's encrypted.",
  errorUnreadable: "The file couldn't be read.",
  errorNotOnDisk: 'Nightlite opens files on a disk. Save a copy into your workspace and open that.',
  formatSqlite: 'SQLite database',
  formatMbtiles: 'MBTiles tileset',
  formatGeopackage: 'GeoPackage',
  fileSize: 'File size',
  pages: 'Pages',
  pagesValue: '{0} × {1}',
  textEncoding: 'Text encoding',
  journal: 'Journal',
  journalWal: 'Write-ahead log (WAL)',
  journalRollback: 'Rollback journal',
  userVersion: 'User version',
  applicationId: 'Application ID',
  writtenBy: 'Last written by',
  databaseObjects: 'Database objects',
  overview: 'Overview',
  tables: 'Tables',
  views: 'Views',
  indexes: 'Indexes',
  triggers: 'Triggers',
  noTables: 'This database has no tables yet.',
  expand: 'Expand',
  collapse: 'Collapse',
  table: 'Table',
  view: 'View',
  index: 'Index',
  trigger: 'Trigger',
  virtualTable: 'Virtual table',
  internalTable: 'SQLite internal',
  withoutRowid: 'WITHOUT ROWID',
  strict: 'STRICT',
  onTable: 'on {0}',
  noSql: 'SQLite keeps no CREATE statement for this object.',
  openErrorTitle: "The database couldn't be opened",
  openErrorDamaged: 'The database file is damaged.',
  openErrorLocked:
    'Another program is writing to the database right now. Reopen it when that program is done.',
  openErrorOther: 'SQLite reported a problem with this database.',
};

/**
 * Loads the built webview (dist/webview) the way VS Code does: same HTML, same CSP,
 * a stubbed `acquireVsCodeApi`, and theme variables on the root element.
 */
export async function openViewer(page: Page, theme: ThemeName) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));

  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/index.html') {
      await route.fulfill({
        contentType: 'text/html',
        body: buildWebviewHtml({
          cspSource: ORIGIN,
          scriptUri: `${ORIGIN}/dist/webview/main.js`,
          styleUri: `${ORIGIN}/dist/webview/main.css`,
          lang: 'en',
        }),
      });
      return;
    }
    try {
      const body = readFileSync(join(process.cwd(), path));
      await route.fulfill({ body, contentType: CONTENT_TYPES[extname(path)] });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });

  await page.addInitScript((theme) => {
    const sent: unknown[] = [];
    let state: unknown;
    // VS Code replaces all theme variables and classes on a theme change.
    const applyTheme = ({ kind, classes, variables }: typeof theme) => {
      const root = document.documentElement;
      for (const name of [...root.style]) {
        if (name.startsWith('--vscode-')) root.style.removeProperty(name);
      }
      for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
      document.body.classList.remove(
        'vscode-dark',
        'vscode-light',
        'vscode-high-contrast',
        'vscode-high-contrast-light',
      );
      document.body.classList.add(...classes);
      document.body.dataset.vscodeThemeKind = kind;
    };
    Object.assign(window, {
      __sent: sent,
      __applyTheme: applyTheme,
      acquireVsCodeApi: () => ({
        postMessage: (message: unknown) => sent.push(message),
        getState: () => state,
        setState: (value: unknown) => (state = value),
      }),
    });
    // Init scripts run before the document exists, so theme it once parsing is done.
    document.addEventListener('DOMContentLoaded', () => applyTheme(theme));
  }, themes[theme] as Theme);

  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(() =>
    (window as unknown as { __sent: { type: string }[] }).__sent.some((m) => m.type === 'ready'),
  );

  return {
    problems,
    /** Delivers a message as if it came from the extension host. */
    async post(message: HostToWebviewMessage) {
      await page.evaluate(
        (data) => window.dispatchEvent(new MessageEvent('message', { data })),
        message,
      );
    },
    /**
     * Sends what the extension host would for a fixture: its header facts, then its schema,
     * or why it can't be shown. `schema: false` stops after the header, as while still opening.
     */
    async load(fixture: string, { schema = true } = {}) {
      const path = join('test/fixtures', fixture);
      const bytes = readFileSync(path).subarray(0, HEADER_SIZE);
      const result = describeFile(path, bytes, statSync(path).size);
      if ('error' in result) {
        await this.post({ type: 'error', fileName: fixture, error: result.error, strings });
        await page.waitForSelector('.nl-error');
        return;
      }
      await this.post({ type: 'load', file: result.file, locale: 'en', strings });
      await page.waitForSelector('.nl-overview');
      if (!schema) return;
      const db = new DatabaseSync(connectionTarget(path, result.file.header.wal), {
        readOnly: true,
      });
      try {
        await this.post({ type: 'schema', objects: readSchema(db) });
      } finally {
        db.close();
      }
      await page.waitForSelector('.nl-sidebar:not([hidden])');
    },
    /** Switches the theme the way VS Code does: CSS variables plus body classes. */
    async setTheme(name: ThemeName) {
      await page.evaluate(
        (theme) => (window as unknown as { __applyTheme(theme: Theme): void }).__applyTheme(theme),
        themes[name] as Theme,
      );
    },
    sent: () => page.evaluate(() => (window as unknown as { __sent: { type: string }[] }).__sent),
  };
}
