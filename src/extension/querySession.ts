import type { HostToWebviewMessage, ObjectInfo, WebviewToHostMessage } from '../shared/protocol';
import { checkQuery } from '../shared/sqlCheck';
import type { DatabaseClient } from './database/client';
import type { QueryProgress } from './database/query';
import { classifyDatabaseError } from './databaseErrors';

/** What a query needs from its worker: `DatabaseClient`'s query calls. */
export type QueryConnection = Pick<
  DatabaseClient,
  | 'queryStart'
  | 'viewStart'
  | 'queryStep'
  | 'queryStop'
  | 'queryRows'
  | 'queryCopy'
  | 'queryCell'
  | 'dispose'
>;

/** Opens the database for one query, on a connection of its own. */
export type QueryConnector = () => { connection: QueryConnection; opened: Promise<void> };

/** The grid's questions about a query's results. */
type ResultsMessage = Extract<WebviewToHostMessage, { type: 'rows' | 'copy' | 'cell' }> & {
  query: number;
};

/** The query page's messages, and the grid's for a query's results. */
export type QueryMessage =
  Extract<WebviewToHostMessage, { type: 'runQuery' | 'runView' | 'stopQuery' }> | ResultsMessage;

/** Whether a message is for the query page's session rather than the document. */
export function isQueryMessage(message: WebviewToHostMessage): message is QueryMessage {
  switch (message.type) {
    case 'runQuery':
    case 'runView':
    case 'stopQuery':
      return true;
    case 'rows':
    case 'copy':
    case 'cell':
      return message.query !== undefined;
    default:
      return false;
  }
}

type Post = (message: HostToWebviewMessage) => Thenable<boolean> | Promise<unknown>;

/** Each step reads rows for this long, so a stop or the grid's questions wait at most that. */
const STEP = 50;
/** Progress goes to the page this often while rows come in. */
const PROGRESS = 100;
/** A stop that SQLite doesn't get to in this long ends the worker, and the rows with it. */
const STOP_WAIT = 500;

interface Run {
  run: number;
  connection: QueryConnection;
  stopping: boolean;
  /** Ended from outside: stopped by force, replaced, or the editor closed. */
  ended: boolean;
}

/**
 * The query page of one editor, or its table views' sorting and filtering: one run at a time,
 * each on a worker of its own, so a slow one never holds up the rest, and stopping it can end
 * its worker (D-021, D-022). The rows stay with that worker for the grid until the next run.
 */
export class QuerySession {
  private current: Run | undefined;

  constructor(
    private readonly connect: QueryConnector,
    private readonly post: Post,
    private readonly writeClipboard: (text: string) => Thenable<void> | Promise<void>,
  ) {}

  async answer(message: QueryMessage): Promise<void> {
    switch (message.type) {
      case 'runQuery': {
        // Checked here too: the page checks before sending, the worker again before running.
        const check = checkQuery(message.sql);
        if (!check.ok) {
          await this.post({
            type: 'queryError',
            run: message.run,
            reason: check.reason,
            detail: '',
          });
          return;
        }
        const { sql } = message;
        return this.run(message.run, (connection) => connection.queryStart(sql));
      }
      case 'runView': {
        const { name, view } = message;
        return this.run(message.run, (connection) => connection.viewStart(name, view));
      }
      case 'stopQuery':
        return this.stop(message.run);
      case 'rows':
      case 'copy':
      case 'cell':
        return this.results(message);
    }
  }

  dispose(): void {
    this.end();
  }

  /** Whether `run` is this session's: the one running, or whose rows are shown. */
  owns(run: number): boolean {
    return this.current?.run === run;
  }

  private async run(
    run: number,
    start: (connection: QueryConnection) => Promise<ObjectInfo>,
  ): Promise<void> {
    this.end();
    const began = performance.now();
    const { connection, opened } = this.connect();
    const current: Run = { run, connection, stopping: false, ended: false };
    this.current = current;
    try {
      await opened;
      const info = await start(connection);
      let progress: QueryProgress = { rows: 0, end: null };
      let posted = performance.now();
      while (progress.end === null && !current.stopping) {
        progress = await connection.queryStep(STEP);
        if (current.ended) return;
        if (progress.end === null && performance.now() - posted >= PROGRESS) {
          posted = performance.now();
          void this.post({ type: 'queryProgress', run, rows: progress.rows });
        }
      }
      const stopped = current.stopping;
      if (stopped) progress = await connection.queryStop();
      if (current.ended) return;
      current.stopping = false;
      await this.post({
        type: 'queryResult',
        run,
        info,
        rows: progress.rows,
        end: stopped ? 'stopped' : (progress.end ?? 'done'),
        ms: Math.round(performance.now() - began),
      });
    } catch (error) {
      if (current.ended && !current.stopping) return;
      if (this.current === current) this.end();
      await this.post(
        current.stopping
          ? { type: 'queryError', run, reason: 'stopped', detail: '' }
          : { type: 'queryError', run, reason: 'failed', ...classifyDatabaseError(error) },
      );
    }
  }

  private stop(run: number): void {
    const current = this.current;
    if (current?.run !== run || current.stopping) return;
    current.stopping = true;
    // SQLite may be busy with a single row, like the first of a sort: end the worker then.
    setTimeout(() => {
      if (this.current === current && current.stopping) {
        current.ended = true;
        current.connection.dispose();
        this.current = undefined;
      }
    }, STOP_WAIT);
  }

  private async results(message: ResultsMessage): Promise<void> {
    // Answers name the grid that asked: the query page's, or a table's sorted or filtered.
    const { request, query, name } = message;
    const connection = this.current?.run === query ? this.current.connection : undefined;
    try {
      if (!connection) throw new Error('These results are gone: another query ran since');
      switch (message.type) {
        case 'rows': {
          const page = await connection.queryRows(message.start, message.count);
          await this.post({ type: 'rowPage', request, name, query, page });
          return;
        }
        case 'copy': {
          const { text, ...result } = await connection.queryCopy(message.range);
          await this.writeClipboard(text);
          await this.post({ type: 'copied', request, name, query, result });
          return;
        }
        case 'cell': {
          const cell = await connection.queryCell(message.row, message.column);
          await this.post({ type: 'cellValue', request, name, query, cell });
          return;
        }
      }
    } catch (error) {
      await this.post({
        type: 'objectError',
        name,
        query,
        request,
        ...classifyDatabaseError(error),
      });
    }
  }

  /** Ends the query running, or the one whose rows are shown. */
  private end(): void {
    const current = this.current;
    if (!current) return;
    current.ended = true;
    current.connection.dispose();
    this.current = undefined;
  }
}

/**
 * One editor's sessions: the query page's, and its table views' sorting and filtering, so that
 * sorting a table never ends a query's results. Each message goes to the session it's for.
 */
export class EditorSessions {
  readonly queries: QuerySession;
  readonly views: QuerySession;

  constructor(
    connect: QueryConnector,
    post: Post,
    writeClipboard: (text: string) => Thenable<void> | Promise<void>,
  ) {
    this.queries = new QuerySession(connect, post, writeClipboard);
    this.views = new QuerySession(connect, post, writeClipboard);
  }

  answer(message: QueryMessage): Promise<void> {
    const run = 'query' in message ? message.query : message.run;
    const toViews =
      message.type === 'runView' || (message.type !== 'runQuery' && this.views.owns(run));
    return (toViews ? this.views : this.queries).answer(message);
  }

  dispose(): void {
    this.queries.dispose();
    this.views.dispose();
  }
}
