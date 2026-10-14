import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { CellValue, CopyRange, FullCell, ObjectInfo, RowPage } from '../../shared/protocol';
import { checkQuery, type QueryCheck } from '../../shared/sqlCheck';
import {
  COPY_LIMIT,
  DETAIL_BYTES,
  IMAGE_PREVIEW,
  QUERY_MEMORY,
  QUERY_ROWS,
  imageKind,
  looksLikeText,
} from '../../shared/values';
import { readGeoPackageHeader } from '../../shared/geometry';
import {
  BLOB_HEAD,
  STORAGE_CLASSES,
  TEXT_LIMIT,
  copyRows,
  copyText,
  encode,
  type CopiedText,
} from './rows';

/** A statement the query page doesn't run: it may write, or there are several (D-021). */
export class QueryRefused extends Error {
  constructor(readonly reason: Exclude<QueryCheck, { ok: true }>['reason']) {
    super(`Query refused: ${reason}`);
  }
}

/** How far a query got: rows kept so far, and why it ended once it has. */
export interface QueryProgress {
  rows: number;
  /** `limit`: there were more rows than results hold. Null while rows are still coming. */
  end: 'done' | 'limit' | null;
}

/**
 * Rows worked out in a worker of their own and kept there, read in steps so they can be stopped:
 * a query's results, or a table's rows sorted or filtered.
 */
export interface ResultRows {
  readonly info: ObjectInfo;
  readonly progress: QueryProgress;
  /** Reads rows for about `ms` milliseconds, or until there are no more or results are full. */
  step(ms: number): QueryProgress;
  /** Stops reading, keeping the rows read so far. */
  stop(): QueryProgress;
  page(start: number, count: number): RowPage;
  copy(range: CopyRange): CopiedText;
  cell(row: number, column: number): FullCell;
}

/** Bytes a value counts for besides its text or bytes, roughly what keeping it takes. */
const VALUE_COST = 16;

/**
 * A statement typed into the query page, run on a connection of its own. Its rows are kept as
 * they're read, values whole up to the copy limit, so the grid pages through them, copies them
 * and shows them in full without running the statement again. Reading stops at QUERY_ROWS rows
 * or QUERY_MEMORY bytes kept.
 */
export class QueryRun implements ResultRows {
  readonly info: ObjectInfo;
  /** Each kept cell as three items: storage class, value, full length. */
  private readonly cells: unknown[] = [];
  private kept = 0;
  private size = 0;
  private iterator: Iterator<unknown[]> | undefined;
  private ended: QueryProgress['end'] = null;

  /** `info` names the columns for a table's rows; a query's are named by SQLite. */
  constructor(db: DatabaseSync, sql: string, params: SQLInputValue[] = [], info?: ObjectInfo) {
    const check = checkQuery(sql);
    if (!check.ok) throw new QueryRefused(check.reason);
    const statement = db.prepare(sql);
    statement.setReadBigInts(true);
    statement.setReturnArrays(true);
    this.info = info ?? {
      name: '',
      columns: statement.columns().map((column) => ({
        name: column.name,
        type: column.type ?? '',
        notNull: false,
        defaultValue: null,
        primaryKey: 0,
        generated: false,
      })),
      hasRowid: false,
      estimate: null,
    };
    this.iterator = (statement.iterate(...params) as IterableIterator<unknown[]>)[
      Symbol.iterator
    ]();
  }

  get progress(): QueryProgress {
    return { rows: this.kept, end: this.ended };
  }

  /** Reads rows for about `ms` milliseconds, or until there are no more or results are full. */
  step(ms: number): QueryProgress {
    const until = performance.now() + ms;
    while (this.iterator && this.ended === null) {
      const next = this.iterator.next();
      if (next.done) {
        this.finish('done');
      } else if (this.kept === QUERY_ROWS || this.size >= QUERY_MEMORY) {
        // A row beyond what results hold: say there were more.
        this.finish('limit');
      } else {
        this.keep(next.value);
        if (performance.now() >= until) break;
      }
    }
    return this.progress;
  }

  /** Stops reading, keeping the rows read so far. */
  stop(): QueryProgress {
    if (this.ended === null) this.finish('done');
    return this.progress;
  }

  /** Rows `start` onwards, as the grid shows them. */
  page(start: number, count: number): RowPage {
    const columns = this.info.columns.length;
    const end = Math.min(this.kept, start + count);
    const rows: CellValue[][] = [];
    const types: string[] = [];
    for (let row = start; row < end; row++) {
      const values: CellValue[] = [];
      let letters = '';
      for (let column = 0; column < columns; column++) {
        const at = (row * columns + column) * 3;
        const kind = this.cells[at] as string;
        const length = this.cells[at + 2] as number;
        let value = this.cells[at + 1];
        if (kind === 'text') value = (value as string).slice(0, TEXT_LIMIT);
        if (kind === 'blob') value = (value as Uint8Array).subarray(0, BLOB_HEAD);
        values.push(encode(kind, value, length));
        letters += STORAGE_CLASSES[kind];
      }
      rows.push(values);
      types.push(letters);
    }
    return { start, rows, types, end: end >= this.kept };
  }

  /** A block of cells as `TableReader.copy` copies them. */
  copy(range: CopyRange): CopiedText {
    const columns = this.info.columns.length;
    const { firstColumn, lastColumn } = range;
    const end = Math.min(this.kept, range.start + (range.count ?? Infinity));
    const cells = this.cells;
    function* rows(start: number): Generator<unknown[]> {
      for (let row = start; row < end; row++) {
        const at = row * columns * 3;
        yield cells.slice(at + firstColumn * 3, at + (lastColumn + 1) * 3);
      }
    }
    return copyRows(
      this.info.columns.slice(firstColumn, lastColumn + 1).map((column) => column.name),
      rows(range.start),
      { markdown: range.markdown, single: range.count === 1 && firstColumn === lastColumn },
    );
  }

  /** One cell in full, as `TableReader.cell` gives it for the detail panel. */
  cell(row: number, column: number): FullCell {
    if (row >= this.kept) return { type: 'n', text: '', length: 0 };
    const at = (row * this.info.columns.length + column) * 3;
    const kind = this.cells[at] as string;
    const value = this.cells[at + 1];
    const length = this.cells[at + 2] as number;
    const type = STORAGE_CLASSES[kind];
    if (kind !== 'blob') return { type, text: copyText(kind, value), length };
    const bytes = value as Uint8Array;
    const cell: FullCell = {
      type,
      text: Buffer.from(bytes.subarray(0, DETAIL_BYTES)).toString('hex'),
      length,
    };
    const whole = bytes.length === length;
    const picture = imageKind(bytes) || readGeoPackageHeader(bytes);
    if (whole && (picture ? length <= IMAGE_PREVIEW : looksLikeText(bytes))) {
      cell.bytes = new Uint8Array(bytes);
    }
    return cell;
  }

  private keep(row: unknown[]): void {
    for (const value of row) {
      if (value === null) {
        this.cells.push('null', null, 0);
      } else if (typeof value === 'bigint') {
        this.cells.push('integer', value, 0);
      } else if (typeof value === 'number') {
        this.cells.push('real', value, 0);
      } else if (typeof value === 'string') {
        const kept = value.length > COPY_LIMIT ? value.slice(0, COPY_LIMIT) : value;
        this.cells.push('text', kept, value.length);
        this.size += kept.length * 2;
      } else {
        // A copy, so that a long BLOB cut short doesn't keep all of it.
        const bytes = value as Uint8Array;
        const kept = bytes.length > COPY_LIMIT / 2 ? bytes.slice(0, COPY_LIMIT / 2) : bytes;
        this.cells.push('blob', kept, bytes.length);
        this.size += kept.length;
      }
      this.size += VALUE_COST;
    }
    this.kept++;
  }

  private finish(end: 'done' | 'limit'): void {
    this.ended = end;
    this.iterator?.return?.();
    this.iterator = undefined;
  }
}
