import type {
  CopyRange,
  ExportSource,
  FullCell,
  GeoPackageSummary,
  HostToWebviewMessage,
  MbtilesSummary,
  MetadataState,
  ObjectDetails,
  ObjectInfo,
  RowPage,
  TableSummary,
  TileContent,
  TilePage,
  WebviewToHostMessage,
  ZoomRange,
} from '../shared/protocol';
import type { TileKey } from '../shared/tiles';
import type { CopiedText } from './database/rows';
import { classifyDatabaseError } from './databaseErrors';
import type { MetadataEdit } from './metadataEdits';
import { isQueryMessage, type QueryMessage } from './querySession';
import { tileExtension } from './tileFile';

/** What answering the webview's questions about tables and views needs from a database. */
export interface DatabaseBackend {
  objectInfo(name: string): Promise<ObjectInfo>;
  rows(name: string, start: number, count: number, total: number): Promise<RowPage>;
  /** May be slow on big tables, and is dropped when another count starts. */
  count(name: string): Promise<number>;
  copy(name: string, range: CopyRange): Promise<CopiedText>;
  cell(name: string, row: number, total: number, column: number, rowid?: string): Promise<FullCell>;
  objectDetails(name: string): Promise<ObjectDetails>;
  /** Slow on big databases; dropped when another count starts. */
  tableSummaries(
    names: string[],
    onSummary: (name: string, summary: TableSummary | null) => void,
  ): Promise<void>;
  mbtiles(): Promise<MbtilesSummary>;
  geopackage(): Promise<GeoPackageSummary>;
  /** Slow on big tilesets; dropped when another count starts. */
  zoomCounts(
    skip: number[],
    onRange: (range: ZoomRange | null) => void,
    onCount: (zoom: number, count: number) => void,
  ): Promise<void>;
  tilePage(zoom: number, start: number, count: number, total: number): Promise<TilePage>;
  locateTile(key: TileKey, total: number): Promise<number>;
  tile(key: TileKey): Promise<TileContent | null>;
  /** A tile's bytes as stored, for saving. */
  storedTile(key: TileKey): Promise<Uint8Array | null>;
  /** An MBTiles file's metadata as the editor shows it, with changes not saved yet. */
  metadataState(): Promise<MetadataState>;
  /** Sets a metadata key, or removes it with null; undefined when nothing changes. */
  editMetadata(name: string, value: string | null, amend?: boolean): MetadataEdit | undefined;
}

type Post = (message: HostToWebviewMessage) => Thenable<boolean> | Promise<unknown>;

/** What only the extension host can do for the webview: the clipboard, files the user picks. */
export interface HostServices {
  writeClipboard(text: string): Thenable<void> | Promise<void>;
  /** Asks where to save a tile, offering `name`, and writes it there. */
  saveTile(name: string, stored: Uint8Array): Thenable<void> | Promise<void>;
  /** A metadata edit was made: VS Code marks the file changed and can undo it. */
  onMetadataEdit(edit: MetadataEdit): void;
  /** Asks where to export rows, offering `name`, and writes them there (D-023). */
  exportRows(source: ExportSource, name: string): Thenable<void> | Promise<void>;
}

/**
 * Answers questions about the database's contents; the query page's go to its session, other
 * messages are left to the caller.
 */
export async function answer(
  message: WebviewToHostMessage,
  backend: DatabaseBackend,
  post: Post,
  host: HostServices,
  queries?: { answer(message: QueryMessage): Promise<void> },
): Promise<void> {
  if (isQueryMessage(message)) {
    await queries?.answer(message);
    return;
  }
  switch (message.type) {
    case 'openObject': {
      let info: ObjectInfo;
      try {
        info = await backend.objectInfo(message.name);
      } catch (error) {
        await post({ type: 'objectError', name: message.name, ...classifyDatabaseError(error) });
        return;
      }
      await post({ type: 'objectInfo', info });
      try {
        await post({
          type: 'rowCount',
          name: message.name,
          count: await backend.count(message.name),
        });
      } catch {
        // Dropped for another table's count, or failed; the estimate stays in place.
      }
      return;
    }
    case 'rows':
      try {
        const page = await backend.rows(message.name, message.start, message.count, message.total);
        await post({ type: 'rowPage', request: message.request, name: message.name, page });
      } catch (error) {
        await post({
          type: 'objectError',
          name: message.name,
          request: message.request,
          ...classifyDatabaseError(error),
        });
      }
      return;
    case 'objectDetails':
      try {
        const details = await backend.objectDetails(message.name);
        await post({ type: 'objectDetails', name: message.name, details });
      } catch (error) {
        await post({
          type: 'objectDetailsError',
          name: message.name,
          ...classifyDatabaseError(error),
        });
      }
      return;
    case 'mbtiles':
      try {
        await post({ type: 'mbtiles', summary: await backend.mbtiles() });
      } catch (error) {
        await post({ type: 'mbtilesError', ...classifyDatabaseError(error) });
      }
      return;
    case 'geopackage':
      try {
        await post({ type: 'geopackage', summary: await backend.geopackage() });
      } catch (error) {
        await post({ type: 'geopackageError', ...classifyDatabaseError(error) });
      }
      return;
    case 'tableSummaries': {
      let complete = false;
      try {
        await backend.tableSummaries(
          message.names,
          (name, summary) => void post({ type: 'tableSummary', name, summary }),
        );
        complete = true;
      } catch {
        // Stopped for another count; the tables counted so far stay.
      }
      await post({ type: 'tableSummariesEnd', complete });
      return;
    }
    case 'zoomCounts': {
      let complete = false;
      try {
        await backend.zoomCounts(
          message.skip,
          (range) => void post({ type: 'zoomRange', range }),
          (zoom, count) => void post({ type: 'zoomCount', zoom, count }),
        );
        complete = true;
      } catch {
        // Stopped for another count, or failed; the levels counted so far stay.
      }
      await post({ type: 'zoomCountsEnd', complete });
      return;
    }
    case 'tiles':
    case 'locateTile':
    case 'tile':
      try {
        await post(await answerTiles(message, backend));
      } catch (error) {
        await post({
          type: 'tilesError',
          request: message.request,
          ...classifyDatabaseError(error),
        });
      }
      return;
    case 'metadata':
      try {
        await post({ type: 'metadataState', state: await backend.metadataState() });
      } catch (error) {
        await post({ type: 'metadataError', ...classifyDatabaseError(error) });
      }
      return;
    case 'editMetadata': {
      // Every editor of the file hears the new state from the document.
      const edit = backend.editMetadata(message.name, message.value, message.amend);
      if (edit) host.onMetadataEdit(edit);
      return;
    }
    case 'exportRows':
      await host.exportRows(message.source, message.name);
      return;
    case 'saveTile': {
      let stored: Uint8Array | null;
      try {
        stored = await backend.storedTile(message.key);
      } catch (error) {
        await post({
          type: 'tilesError',
          request: message.request,
          ...classifyDatabaseError(error),
        });
        return;
      }
      if (stored) await host.saveTile(`${message.name}.${tileExtension(stored)}`, stored);
      return;
    }
    case 'cell':
      try {
        const cell = await backend.cell(
          message.name,
          message.row,
          message.total,
          message.column,
          message.rowid,
        );
        await post({ type: 'cellValue', request: message.request, name: message.name, cell });
      } catch (error) {
        await post({
          type: 'objectError',
          name: message.name,
          request: message.request,
          ...classifyDatabaseError(error),
        });
      }
      return;
    case 'copy':
      try {
        const { text, ...result } = await backend.copy(message.name, message.range);
        await host.writeClipboard(text);
        await post({ type: 'copied', request: message.request, name: message.name, result });
      } catch (error) {
        await post({
          type: 'objectError',
          name: message.name,
          request: message.request,
          ...classifyDatabaseError(error),
        });
      }
      return;
  }
}

/** The tile browser's questions, each answered from the reader. */
async function answerTiles(
  message: Extract<WebviewToHostMessage, { type: 'tiles' | 'locateTile' | 'tile' }>,
  backend: DatabaseBackend,
): Promise<HostToWebviewMessage> {
  const { request } = message;
  switch (message.type) {
    case 'tiles': {
      const { zoom, start, count, total } = message;
      return {
        type: 'tilePage',
        request,
        zoom,
        page: await backend.tilePage(zoom, start, count, total),
      };
    }
    case 'locateTile':
      return {
        type: 'tilePosition',
        request,
        key: message.key,
        position: await backend.locateTile(message.key, message.total),
      };
    case 'tile':
      return {
        type: 'tileContent',
        request,
        key: message.key,
        content: await backend.tile(message.key),
      };
  }
}
