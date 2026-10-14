import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { ExportFormat, ExportSource } from '../../shared/protocol';
import { realText } from '../../shared/values';
import { QueryRefused } from './query';
import { viewClauses } from './rowView';
import { quote, type TableReader } from './rows';
import { checkQuery } from '../../shared/sqlCheck';

/** Some of an export's text, and how far it got. */
export interface ExportChunk {
  text: string;
  rows: number;
  done: boolean;
}

/** A value as export text: NULL as nothing, reals as the grid shows them, BLOBs as hex. */
function valueText(value: unknown): string {
  if (value === null) return '';
  if (typeof value === 'number') return realText(value);
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  return String(value);
}

/** A CSV field, quoted when it has to be (RFC 4180). */
export function csvField(value: unknown): string {
  const text = valueText(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A value as JSON: integers to the last digit, even past 2^53, reals keeping their decimal
 * point, and the infinities, which JSON has no number for, as text.
 */
export function jsonValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'number') {
    return Number.isFinite(value) ? realText(value) : JSON.stringify(String(value));
  }
  return JSON.stringify(valueText(value));
}

/** Column names as JSON keys: a name given twice, as a query may, gets a number. */
function uniqueKeys(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return JSON.stringify(count === 1 ? name : `${name}_${count}`);
  });
}

/** What an export reads: a table's rows as shown, sorted and filtered, or a query's rows. */
export function exportStatement(
  source: ExportSource,
  reader: (name: string) => TableReader,
): { sql: string; params: SQLInputValue[] } {
  if ('sql' in source) {
    const check = checkQuery(source.sql);
    if (!check.ok) throw new QueryRefused(check.reason);
    return { sql: source.sql, params: [] };
  }
  const table = reader(source.table);
  const { where, params, order } = viewClauses(table.info.columns, source.view);
  const columns = table.info.columns.map((column) => quote(column.name)).join(', ');
  // In the grid's order: by the sort, then as stored.
  const by = [order, table.info.hasRowid ? 'rowid' : ''].filter(Boolean).join(', ');
  return {
    sql: `SELECT ${columns} ${table.source} ${where} ${by ? `ORDER BY ${by}` : ''}`,
    params,
  };
}

/**
 * Rows written out as CSV or JSON, a chunk at a time so the extension host writes the file as
 * it goes and can stop: every row, values whole, however many there are.
 */
export class ExportRun {
  private readonly names: string[];
  private readonly keys: string[];
  private readonly iterator: Iterator<unknown[]>;
  private rows = 0;
  private started = false;
  private finished = false;

  constructor(
    db: DatabaseSync,
    { sql, params }: { sql: string; params: SQLInputValue[] },
    private readonly format: ExportFormat,
  ) {
    const statement = db.prepare(sql);
    statement.setReadBigInts(true);
    statement.setReturnArrays(true);
    this.names = statement.columns().map((column) => column.name);
    this.keys = uniqueKeys(this.names);
    this.iterator = (statement.iterate(...params) as IterableIterator<unknown[]>)[
      Symbol.iterator
    ]();
  }

  /** About `bytes` of text, or as much as `ms` milliseconds read, whichever comes first. */
  next(bytes: number, ms: number): ExportChunk {
    const until = performance.now() + ms;
    const parts: string[] = [];
    let size = 0;
    if (!this.started) {
      this.started = true;
      parts.push(this.format === 'csv' ? `${this.names.map(csvField).join(',')}\r\n` : '[');
    }
    while (!this.finished && size < bytes) {
      const next = this.iterator.next();
      if (next.done) {
        this.finished = true;
        if (this.format === 'json') parts.push(this.rows > 0 ? '\n]\n' : ']\n');
        break;
      }
      const line = this.line(next.value);
      parts.push(line);
      size += line.length;
      this.rows++;
      if (this.rows % 256 === 0 && performance.now() >= until) break;
    }
    return { text: parts.join(''), rows: this.rows, done: this.finished };
  }

  private line(row: unknown[]): string {
    if (this.format === 'csv') return `${row.map(csvField).join(',')}\r\n`;
    const fields = row.map((value, c) => `${this.keys[c]}: ${jsonValue(value)}`);
    return `${this.rows > 0 ? ',' : ''}\n  {${fields.join(', ')}}`;
  }
}
