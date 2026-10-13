import type {
  CopyRange,
  FullCell,
  HostToWebviewMessage,
  MbtilesSummary,
  ObjectInfo,
  RowPage,
  WebviewToHostMessage,
  ZoomRange,
} from '../shared/protocol';
import type { CopiedText } from './database/rows';
import { classifyDatabaseError } from './databaseErrors';

/** What answering the webview's questions about tables and views needs from a database. */
export interface DatabaseBackend {
  objectInfo(name: string): Promise<ObjectInfo>;
  rows(name: string, start: number, count: number, total: number): Promise<RowPage>;
  /** May be slow on big tables, and is dropped when another count starts. */
  count(name: string): Promise<number>;
  copy(name: string, range: CopyRange): Promise<CopiedText>;
  cell(name: string, row: number, total: number, column: number, rowid?: string): Promise<FullCell>;
  mbtiles(): Promise<MbtilesSummary>;
  /** Slow on big tilesets; dropped when another count starts. */
  zoomCounts(
    skip: number[],
    onRange: (range: ZoomRange | null) => void,
    onCount: (zoom: number, count: number) => void,
  ): Promise<void>;
}

type Post = (message: HostToWebviewMessage) => Thenable<boolean> | Promise<unknown>;

/** Writes the system clipboard, which only the extension host can do while the webview waits. */
export type WriteClipboard = (text: string) => Thenable<void> | Promise<void>;

/** Answers questions about the database's contents; other messages are left to the caller. */
export async function answer(
  message: WebviewToHostMessage,
  backend: DatabaseBackend,
  post: Post,
  writeClipboard: WriteClipboard,
): Promise<void> {
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
    case 'mbtiles':
      try {
        await post({ type: 'mbtiles', summary: await backend.mbtiles() });
      } catch (error) {
        await post({ type: 'mbtilesError', ...classifyDatabaseError(error) });
      }
      return;
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
        await writeClipboard(text);
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
