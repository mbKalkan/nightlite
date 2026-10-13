import type {
  HostToWebviewMessage,
  ObjectInfo,
  RowPage,
  WebviewToHostMessage,
} from '../shared/protocol';
import { classifyDatabaseError } from './databaseErrors';

/** What answering the webview's questions about tables and views needs from a database. */
export interface DatabaseBackend {
  objectInfo(name: string): Promise<ObjectInfo>;
  rows(name: string, start: number, count: number, total: number): Promise<RowPage>;
  /** May be slow on big tables, and is dropped when another count starts. */
  count(name: string): Promise<number>;
}

type Post = (message: HostToWebviewMessage) => Thenable<boolean> | Promise<unknown>;

/** Answers `openObject` and `rows`; other messages are left to the caller. */
export async function answer(
  message: WebviewToHostMessage,
  backend: DatabaseBackend,
  post: Post,
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
  }
}
