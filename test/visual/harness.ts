import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Page } from '@playwright/test';
import { readDetails } from '../../src/extension/database/details';
import {
  readMbtiles,
  readMetadataRows,
  zoomCount,
  zoomRange,
} from '../../src/extension/database/mbtiles';
import { writeMetadata } from '../../src/extension/database/metadataWrite';
import { TableReader } from '../../src/extension/database/rows';
import { readSchema } from '../../src/extension/database/schema';
import { READ_OPTIONS, connectionTarget } from '../../src/extension/database/target';
import { TileLister, readStoredTile, readTile } from '../../src/extension/database/tiles';
import { readFileHeader } from '../../src/extension/fileHeader';
import { MetadataEdits, type MetadataEdit } from '../../src/extension/metadataEdits';
import { tileBytes } from '../../src/extension/tileFile';
import { answer } from '../../src/extension/requests';
import { viewerStrings } from '../../src/extension/strings';
import { buildWebviewHtml } from '../../src/extension/webviewHtml';
import type {
  HostToWebviewMessage,
  ViewerStrings,
  WebviewToHostMessage,
} from '../../src/shared/protocol';
import { zoomLevels } from '../../src/shared/mbtiles';
import { describeFile } from '../../src/shared/sqliteHeader';
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

/** The strings in English, as VS Code's l10n gives them without a translation. */
export const strings: ViewerStrings = viewerStrings({ t: (message) => message });

/** Pages already given `__toHost`; opening the viewer again on one replaces its host. */
const exposed = new WeakSet<Page>();
const hosts = new WeakMap<Page, (message: WebviewToHostMessage) => Promise<void>>();

/** How the stand-in extension host answers: `count: false` never finishes counting rows. */
export interface HostOptions {
  schema?: boolean;
  count?: boolean;
  /** Opens a copy in a folder of its own, so saving metadata leaves the fixture alone. */
  writable?: boolean;
}

/**
 * Loads the built webview (dist/webview) the way VS Code does: same HTML, same CSP,
 * a stubbed `acquireVsCodeApi`, and theme variables on the root element. Requests for rows go
 * to a stand-in extension host that answers from the fixture with the extension's own code.
 */
export async function openViewer(page: Page, theme: ThemeName) {
  const problems: string[] = [];
  const clipboard: string[] = [];
  const saved: { name: string; bytes: Uint8Array }[] = [];
  let database:
    | {
        db: DatabaseSync;
        readers: Map<string, TableReader>;
        listers: Map<number, TileLister>;
        count: boolean;
        path: string;
        metadata: MetadataEdits;
      }
    | undefined;
  /** Metadata edits on VS Code's undo stack, latest last, and those undone. */
  const undoStack: MetadataEdit[] = [];
  const redoStack: MetadataEdit[] = [];
  const copies: string[] = [];
  const connection = () => {
    if (!database) throw new Error('No database loaded');
    return database.db;
  };
  const reader = (name: string) => {
    if (!database) throw new Error('No database loaded');
    let found = database.readers.get(name);
    if (!found) {
      found = new TableReader(database.db, name);
      database.readers.set(name, found);
    }
    return found;
  };
  const lister = (zoom: number) => {
    if (!database) throw new Error('No database loaded');
    let found = database.listers.get(zoom);
    if (!found) {
      found = new TileLister(database.db, zoom);
      database.listers.set(zoom, found);
    }
    return found;
  };
  // Playwright passes JSON; a tile's bytes travel as base64 and become bytes again on the page.
  const post = (message: HostToWebviewMessage) => {
    const bytes =
      message.type === 'tileContent' && message.content?.data
        ? Buffer.from(message.content.data).toString('base64')
        : null;
    const data =
      bytes !== null && message.type === 'tileContent' && message.content
        ? { ...message, content: { ...message.content, data: null } }
        : message;
    return page.evaluate(
      ([payload, base64]) => {
        if (base64 !== null) {
          (payload as { content: { data: Uint8Array } }).content.data = Uint8Array.from(
            atob(base64),
            (c) => c.charCodeAt(0),
          );
        }
        window.dispatchEvent(new MessageEvent('message', { data: payload }));
      },
      [data, bytes] as const,
    );
  };
  const metadata = () => {
    if (!database) throw new Error('No database loaded');
    if (!database.metadata.loaded) database.metadata.setRows(readMetadataRows(database.db));
    return database.metadata;
  };
  const postMetadata = () => post({ type: 'metadataState', state: metadata().state() });
  hosts.set(page, (message: WebviewToHostMessage) =>
    answer(
      message,
      {
        objectInfo: async (name) => reader(name).info,
        rows: async (name, start, count, total) => reader(name).page(start, count, total),
        count: (name) =>
          database?.count ? Promise.resolve(reader(name).count()) : new Promise<number>(() => {}),
        copy: async (name, range) => reader(name).copy(range),
        cell: async (name, row, total, column, rowid) =>
          reader(name).cell(row, total, column, rowid),
        objectDetails: async (name) => readDetails(connection(), name),
        tableSummaries: async (names, onSummary) => {
          if (!database?.count) return new Promise<void>(() => {});
          for (const name of names) {
            const table = reader(name);
            onSummary(name, { rows: table.count(), columns: table.info.columns.length });
          }
        },
        mbtiles: async () => readMbtiles(connection()),
        zoomCounts: async (skip, onRange, onCount) => {
          if (!database?.count) return new Promise<void>(() => {});
          const range = zoomRange(connection());
          onRange(range);
          for (const zoom of range ? zoomLevels(range) : []) {
            if (!skip.includes(zoom)) onCount(zoom, zoomCount(connection(), zoom));
          }
        },
        tilePage: async (zoom, start, count, total) => lister(zoom).page(start, count, total),
        locateTile: async (key, total) => lister(key.zoom).locate(key.column, key.row, total),
        tile: async (key) => readTile(connection(), key.zoom, key.column, key.row),
        storedTile: async (key) => readStoredTile(connection(), key.zoom, key.column, key.row),
        metadataState: async () => metadata().state(),
        // As the document does: every change is posted, edits go on the undo stack.
        editMetadata: (name, value, amend) => {
          const { changed, edit } = metadata().edit(name, value, amend);
          if (changed) void postMetadata();
          return edit;
        },
      },
      post,
      {
        writeClipboard: async (text) => {
          clipboard.push(text);
        },
        // As if the user took the name offered.
        saveTile: async (name, stored) => {
          saved.push({ name, bytes: tileBytes(stored, name) });
        },
        onMetadataEdit: (edit) => {
          undoStack.push(edit);
          redoStack.length = 0;
        },
      },
    ),
  );
  if (!exposed.has(page)) {
    exposed.add(page);
    await page.exposeFunction('__toHost', (message: WebviewToHostMessage) =>
      hosts.get(page)?.(message),
    );
  }
  page.on('close', () => {
    database?.db.close();
    for (const folder of copies) rmSync(folder, { recursive: true, force: true });
  });
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
        postMessage: (message: unknown) => {
          sent.push(message);
          void (window as unknown as { __toHost(message: unknown): Promise<void> }).__toHost(
            message,
          );
        },
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
    /** What the stand-in host wrote to the clipboard, latest last. */
    clipboard,
    /** Tiles saved, with the name offered and the bytes written. */
    saved,
    /** Delivers a message as if it came from the extension host. */
    async post(message: HostToWebviewMessage) {
      await post(message);
    },
    /**
     * Sends what the extension host would for a fixture: its header facts, then its schema,
     * or why it can't be shown. `schema: false` stops after the header, as while still opening;
     * `count: false` leaves row counts running forever.
     */
    async load(
      fixture: string,
      { schema = true, count = true, writable = false }: HostOptions = {},
    ) {
      // Files outside the fixtures, like ones kept in test/fixtures/private, by their own path.
      let path = isAbsolute(fixture) ? fixture : join('test/fixtures', fixture);
      if (writable) {
        const folder = mkdtempSync(join(tmpdir(), 'nightlite-visual-'));
        copies.push(folder);
        const copy = join(folder, basename(path));
        copyFileSync(path, copy);
        path = copy;
      }
      // As the extension does: the header only, since files can be tens of gigabytes.
      const header = await readFileHeader(path);
      const result = describeFile(path, header.bytes, header.size);
      if ('error' in result) {
        await this.post({ type: 'error', fileName: fixture, error: result.error, strings });
        await page.waitForSelector('.nl-error');
        return;
      }
      await this.post({ type: 'load', file: result.file, locale: 'en', strings });
      // Loading the same file again keeps the page up while the database reopens.
      await page.waitForSelector('.nl-overview, .nl-content[aria-busy="true"]');
      if (!schema) return;
      database?.db.close();
      const db = new DatabaseSync(connectionTarget(path, result.file.header.wal), READ_OPTIONS);
      database = {
        db,
        readers: new Map(),
        listers: new Map(),
        count,
        path,
        metadata: new MetadataEdits(),
      };
      await this.post({ type: 'schema', objects: readSchema(db) });
      await page.waitForSelector('.nl-sidebar:not([hidden])');
    },
    /** VS Code's Undo and Redo on the metadata edits, as Ctrl+Z and Ctrl+Y outside a field do. */
    async undo() {
      const edit = undoStack.pop();
      if (!edit) return;
      edit.undo();
      redoStack.push(edit);
      await postMetadata();
    },
    async redo() {
      const edit = redoStack.pop();
      if (!edit) return;
      edit.redo();
      undoStack.push(edit);
      await postMetadata();
    },
    /** Saves the metadata changes into the copy opened `writable`, as VS Code's Save does. */
    async save() {
      if (!database) throw new Error('No database loaded');
      const changes = metadata().changes();
      writeMetadata(database.path, changes);
      database.metadata.clear();
      database.metadata.setRows(readMetadataRows(database.db));
      await postMetadata();
      await post({ type: 'mbtiles', summary: readMbtiles(database.db) });
      return changes;
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
