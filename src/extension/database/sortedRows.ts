import type { DatabaseSync } from 'node:sqlite';
import type { CopyRange, FullCell, ObjectInfo, RowPage } from '../../shared/protocol';
import type { RowView } from '../../shared/rowFilter';
import { VIEW_ROWS } from '../../shared/values';
import { QueryRun, type QueryProgress, type ResultRows } from './query';
import { viewClauses } from './rowView';
import { copyRows, quote, type CopiedText, type TableReader } from './rows';

/** Rowids copied at a time. */
const COPY_CHUNK = 1000;

/**
 * A rowid table's rows sorted or filtered (D-022): the rowids in that order are worked out once
 * and kept, eight bytes a row, so the grid jumps anywhere at once and reads its rows by rowid.
 * Holds up to VIEW_ROWS rows.
 */
export class SortedRows implements ResultRows {
  readonly info: ObjectInfo;
  private rowids = new BigInt64Array(1024);
  private kept = 0;
  private iterator: Iterator<unknown[]> | undefined;
  private ended: QueryProgress['end'] = null;

  constructor(
    db: DatabaseSync,
    private readonly reader: TableReader,
    view: RowView,
  ) {
    this.info = { ...reader.info, estimate: null };
    const { where, params, order } = viewClauses(reader.info.columns, view);
    // The rowid settles ties, so the same view always lists rows the same way.
    const statement = db.prepare(
      `SELECT rowid ${reader.source} ${where} ORDER BY ${order ? `${order}, ` : ''}rowid`,
    );
    statement.setReadBigInts(true);
    statement.setReturnArrays(true);
    this.iterator = (statement.iterate(...params) as IterableIterator<unknown[]>)[
      Symbol.iterator
    ]();
  }

  get progress(): QueryProgress {
    return { rows: this.kept, end: this.ended };
  }

  step(ms: number): QueryProgress {
    const until = performance.now() + ms;
    while (this.iterator && this.ended === null) {
      const next = this.iterator.next();
      if (next.done) {
        this.finish('done');
      } else if (this.kept === VIEW_ROWS) {
        this.finish('limit');
      } else {
        if (this.kept === this.rowids.length) {
          const grown = new BigInt64Array(this.rowids.length * 2);
          grown.set(this.rowids);
          this.rowids = grown;
        }
        this.rowids[this.kept++] = next.value[0] as bigint;
        // Checking the clock costs more than a row; every thousandth is often enough.
        if (this.kept % 1024 === 0 && performance.now() >= until) break;
      }
    }
    return this.progress;
  }

  stop(): QueryProgress {
    if (this.ended === null) this.finish('done');
    return this.progress;
  }

  page(start: number, count: number): RowPage {
    const end = Math.min(this.kept, start + count);
    const page = this.reader.rowsByRowid([...this.rowids.subarray(start, end)], start);
    return { ...page, end: end >= this.kept };
  }

  copy(range: CopyRange): CopiedText {
    const { firstColumn, lastColumn } = range;
    const end = Math.min(this.kept, range.start + (range.count ?? Infinity));
    const { reader, rowids } = this;
    function* rows(): Generator<unknown[]> {
      for (let at = range.start; at < end; at += COPY_CHUNK) {
        const chunk = [...rowids.subarray(at, Math.min(end, at + COPY_CHUNK))];
        yield* reader.valuesByRowid(chunk, firstColumn, lastColumn);
      }
    }
    return copyRows(
      this.info.columns.slice(firstColumn, lastColumn + 1).map((column) => column.name),
      rows(),
      { markdown: range.markdown, single: range.count === 1 && firstColumn === lastColumn },
    );
  }

  cell(row: number, column: number): FullCell {
    if (row >= this.kept) return { type: 'n', text: '', length: 0 };
    return this.reader.cell(row, this.kept, column, String(this.rowids[row]));
  }

  private finish(end: 'done' | 'limit'): void {
    this.ended = end;
    this.iterator?.return?.();
    this.iterator = undefined;
  }
}

/**
 * A table's or view's rows as `view` asks: by rowid for rowid tables; for views and tables
 * without rowids, the rows themselves are kept, as a query's are.
 */
export function viewRows(db: DatabaseSync, reader: TableReader, view: RowView): ResultRows {
  if (reader.info.hasRowid) return new SortedRows(db, reader, view);
  const { where, params, order } = viewClauses(reader.info.columns, view);
  const columns = reader.info.columns.map((column) => quote(column.name)).join(', ');
  return new QueryRun(
    db,
    `SELECT ${columns} ${reader.source} ${where} ${order ? `ORDER BY ${order}` : ''}`,
    params,
    { ...reader.info, estimate: null },
  );
}
