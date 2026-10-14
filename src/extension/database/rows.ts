import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import type {
  CellValue,
  ColumnInfo,
  CopyRange,
  CopyResult,
  FullCell,
  ObjectInfo,
  RowPage,
} from '../../shared/protocol';
import {
  COPY_LIMIT,
  COPY_ROWS,
  DETAIL_BYTES,
  DETAIL_TEXT,
  IMAGE_PREVIEW,
  imageKind,
  looksLikeText,
  markdownCell,
  markdownTable,
  realText,
  tsvField,
} from '../../shared/values';

/** Text longer than this is cut for the grid; the cell says how long it really is. */
export const TEXT_LIMIT = 1000;
/** BLOBs travel as their size and first bytes, enough to tell a PNG from a gzip. */
export const BLOB_HEAD = 48;
/** How far from a row already read the next read may start before positions are estimated. */
const NEAR = 2000;

export const STORAGE_CLASSES: Record<string, string> = {
  null: 'n',
  integer: 'i',
  real: 'f',
  text: 't',
  blob: 'b',
};

export const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;

interface XInfoRow {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
  hidden: number;
}

/** A copy's text and how much of the selection it holds. */
export type CopiedText = CopyResult & { text: string };

/** A known row: its position in the grid and its rowid. */
interface Anchor {
  position: number;
  rowid: bigint;
}

/**
 * Reads one table or view a page at a time. Rowid tables are read by rowid ranges: a jump to a
 * far position estimates the rowid there from the rowid span (exact when rowids have no gaps,
 * as in append-only tables), and pages next to ones already read continue from their rowids,
 * so scrolling stays consistent. OFFSET walks every row before it (17 s for 35 M rows of a
 * 24 GB file), so it is only used within a short distance of a known row, or for views and
 * tables without rowids.
 */
export class TableReader {
  readonly info: ObjectInfo;
  private readonly from: string;
  private readonly select: string;
  private readonly anchors: Anchor[] = [];
  private readonly span: { min: bigint; max: bigint } | undefined;
  private statements = new Map<string, StatementSync>();

  constructor(
    private readonly db: DatabaseSync,
    name: string,
  ) {
    const kind = db
      .prepare("SELECT type, wr FROM pragma_table_list WHERE schema = 'main' AND name = ?")
      .get(name) as { type: string; wr: number } | undefined;
    const hasRowid = (kind?.type === 'table' || kind?.type === 'shadow') && kind.wr === 0;
    const columns: ColumnInfo[] = (
      db
        .prepare('SELECT name, type, "notnull", dflt_value, pk, hidden FROM pragma_table_xinfo(?)')
        .all(name) as unknown as XInfoRow[]
    )
      // Hidden columns of virtual tables are arguments, not data.
      .filter((column) => column.hidden !== 1)
      .map((column) => ({
        name: column.name,
        type: column.type,
        notNull: column.notnull === 1,
        defaultValue: column.dflt_value,
        primaryKey: column.pk,
        generated: column.hidden >= 2,
      }));

    this.from = `FROM main.${quote(name)}`;
    this.select = `SELECT ${hasRowid ? 'rowid, ' : ''}${valueList(columns, TEXT_LIMIT, BLOB_HEAD)}`;

    let estimate: number | null = null;
    if (hasRowid) {
      // Each end of the rowid b-tree is one lookup; min() and max() in one SELECT would scan.
      const statement = db.prepare(
        `SELECT (SELECT min(rowid) ${this.from}) AS lo, (SELECT max(rowid) ${this.from}) AS hi`,
      );
      statement.setReadBigInts(true);
      const ends = statement.get() as { lo: bigint | null; hi: bigint | null };
      if (ends.lo !== null && ends.hi !== null) {
        this.span = { min: ends.lo, max: ends.hi };
        estimate = Number(this.span.max - this.span.min + 1n);
      } else {
        estimate = 0;
      }
    }
    this.info = { name, columns, hasRowid, estimate };
  }

  count(): number {
    const row = this.db.prepare(`SELECT count(*) AS n ${this.from}`).get() as { n: number };
    return row.n;
  }

  /** `total` is the row count the grid works with: exact once counted, else the estimate. */
  page(start: number, count: number, total: number): RowPage {
    if (!this.info.hasRowid || !this.span) {
      return this.read(
        `${this.select} ${this.from} LIMIT ? OFFSET ?`,
        [count, start],
        start,
        count,
      );
    }
    const below = this.nearest(start, -1);
    const above = this.nearest(start + count - 1, 1);
    if (below && start - below.position <= NEAR) {
      return this.read(
        `${this.select} ${this.from} WHERE rowid >= ? ORDER BY rowid LIMIT ? OFFSET ?`,
        [below.rowid, count, start - below.position],
        start,
        count,
      );
    }
    if (above && above.position - (start + count - 1) <= NEAR) {
      // Read backwards from the known row above, so the page meets it without gaps or repeats.
      const skip = above.position - (start + count - 1);
      const page = this.read(
        `${this.select} ${this.from} WHERE rowid <= ? ORDER BY rowid DESC LIMIT ? OFFSET ?`,
        [above.rowid, count, skip],
        start,
        count,
        true,
      );
      return { ...page, end: false };
    }
    return this.read(
      `${this.select} ${this.from} WHERE rowid >= ? ORDER BY rowid LIMIT ?`,
      [this.estimateRowid(start, total), count],
      start,
      count,
    );
  }

  /**
   * The full values of a block of cells as tab-separated text, the rows found as `page` finds
   * them, so the copy is what the grid shows. One cell copies as its bare value. Stops at
   * COPY_ROWS rows or COPY_LIMIT characters: reading a million rows of a 24 GB MBTiles, where
   * each row's tile sits beside it, already takes a second, and scrolling waits for it.
   */
  copy(range: CopyRange): CopiedText {
    const columns = this.info.columns.slice(range.firstColumn, range.lastColumn + 1);
    const select = `SELECT ${valueList(columns, COPY_LIMIT, COPY_LIMIT / 2)} ${this.from}`;
    // One row more than a copy holds tells that there were more.
    const limit = Math.min(range.count ?? Infinity, COPY_ROWS + 1);
    let sql: string;
    let params: SQLInputValue[];
    if (this.info.hasRowid && this.span) {
      const first = this.rowidAt(range.start, range.total);
      if (first === undefined) {
        return { text: '', rows: 0, cells: 0, stopped: false, cut: false };
      }
      sql = `${select} WHERE rowid >= ? ORDER BY rowid LIMIT ?`;
      params = [first, limit];
    } else {
      sql = `${select} LIMIT ? OFFSET ?`;
      params = [limit, range.start];
    }
    const statement = this.db.prepare(sql);
    statement.setReadBigInts(true);
    statement.setReturnArrays(true);

    return copyRows(
      columns.map((column) => column.name),
      statement.iterate(...params) as Iterable<unknown[]>,
      { markdown: range.markdown, single: range.count === 1 && columns.length === 1 },
    );
  }

  /**
   * One cell's value for the detail panel: by its row's rowid when the grid knows it, else
   * found by position the way `page` finds rows.
   */
  cell(position: number, total: number, column: number, rowid?: string): FullCell {
    const columns = this.info.columns.slice(column, column + 1);
    let where: string;
    let params: SQLInputValue[];
    if (this.info.hasRowid && (rowid !== undefined || this.span)) {
      const id = rowid !== undefined ? BigInt(rowid) : this.rowidAt(position, total);
      if (id === undefined) return { type: 'n', text: '', length: 0 };
      [where, params] = ['WHERE rowid = ?', [id]];
    } else {
      [where, params] = ['LIMIT 1 OFFSET ?', [position]];
    }
    const read = (blobLimit: number) =>
      this.one(
        `SELECT ${valueList(columns, DETAIL_TEXT, blobLimit)} ${this.from} ${where}`,
        params,
      );
    const row = read(DETAIL_BYTES);
    if (!row || columns.length === 0) return { type: 'n', text: '', length: 0 };
    const kind = row[0] as string;
    const length = Number(row[2] ?? 0);
    const cell: FullCell = {
      type: STORAGE_CLASSES[kind] ?? 't',
      text: copyText(kind, row[1]),
      length,
    };
    if (kind === 'blob' && row[1]) {
      // Images and text are read whole, to show as what they are; anything else stays a hex dump.
      const head = row[1] as Uint8Array;
      const limit = imageKind(head) ? IMAGE_PREVIEW : looksLikeText(head) ? DETAIL_TEXT : 0;
      if (length <= limit) {
        const whole = length <= DETAIL_BYTES ? head : (read(limit)?.[1] as Uint8Array | undefined);
        if (whole) cell.bytes = new Uint8Array(whole);
      }
    }
    return cell;
  }

  private one(sql: string, params: SQLInputValue[]): unknown[] | undefined {
    const statement = this.db.prepare(sql);
    statement.setReadBigInts(true);
    statement.setReturnArrays(true);
    return statement.get(...params) as unknown[] | undefined;
  }

  /** The rowid at a grid position, found the way `page` finds the first row of a page. */
  private rowidAt(position: number, total: number): bigint | undefined {
    const below = this.nearest(position, -1);
    const above = this.nearest(position, 1);
    let sql: string;
    let params: SQLInputValue[];
    if (below && position - below.position <= NEAR) {
      sql = 'WHERE rowid >= ? ORDER BY rowid LIMIT 1 OFFSET ?';
      params = [below.rowid, position - below.position];
    } else if (above && above.position - position <= NEAR) {
      sql = 'WHERE rowid <= ? ORDER BY rowid DESC LIMIT 1 OFFSET ?';
      params = [above.rowid, above.position - position];
    } else {
      sql = 'WHERE rowid >= ? ORDER BY rowid LIMIT 1';
      params = [this.estimateRowid(position, total)];
    }
    const statement = this.db.prepare(`SELECT rowid AS r ${this.from} ${sql}`);
    statement.setReadBigInts(true);
    const row = statement.get(...params) as { r: bigint } | undefined;
    return row?.r;
  }

  /** Where a position falls in the rowid span, as if rowids had no gaps. */
  private estimateRowid(position: number, total: number): bigint {
    const span = this.span as { min: bigint; max: bigint };
    const size = Number(span.max - span.min + 1n);
    return span.min + BigInt(Math.floor((position / Math.max(total, 1)) * size));
  }

  private nearest(position: number, direction: -1 | 1): Anchor | undefined {
    let best: Anchor | undefined;
    for (const anchor of this.anchors) {
      const distance = (anchor.position - position) * direction;
      if (distance >= 0 && (!best || distance < (best.position - position) * direction)) {
        best = anchor;
      }
    }
    return best;
  }

  private read(
    sql: string,
    params: SQLInputValue[],
    start: number,
    count: number,
    backwards = false,
  ): RowPage {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      statement.setReadBigInts(true);
      statement.setReturnArrays(true);
      this.statements.set(sql, statement);
    }
    const raw = statement.all(...params) as unknown as unknown[][];
    if (backwards) {
      raw.reverse();
    }
    const offset = this.info.hasRowid ? 1 : 0;
    const rows: CellValue[][] = [];
    const types: string[] = [];
    const rowids: string[] | undefined = this.info.hasRowid ? [] : undefined;
    for (const row of raw) {
      const values: CellValue[] = [];
      let kinds = '';
      for (let c = 0; c < this.info.columns.length; c++) {
        const kind = row[offset + c * 3] as string;
        kinds += STORAGE_CLASSES[kind] ?? 't';
        values.push(encode(kind, row[offset + c * 3 + 1], row[offset + c * 3 + 2]));
      }
      rows.push(values);
      types.push(kinds);
      rowids?.push(String(row[0]));
    }
    if (this.info.hasRowid && raw.length > 0) {
      this.remember({ position: start, rowid: raw[0][0] as bigint });
      this.remember({ position: start + raw.length - 1, rowid: raw[raw.length - 1][0] as bigint });
    }
    return { start, rows, types, rowids, end: !backwards && raw.length < count };
  }

  private remember(anchor: Anchor): void {
    const existing = this.anchors.findIndex((a) => a.position === anchor.position);
    if (existing >= 0) {
      this.anchors[existing] = anchor;
    } else {
      this.anchors.push(anchor);
    }
    // A few hundred anchors are plenty; drop the oldest.
    if (this.anchors.length > 400) {
      this.anchors.splice(0, this.anchors.length - 400);
    }
  }
}

/**
 * Each column's storage class, value and length. Text and BLOBs are read only up to a limit,
 * so a gigabyte BLOB costs no more than its first bytes.
 */
function valueList(columns: ColumnInfo[], textLimit: number, blobLimit: number): string {
  return columns
    .flatMap(({ name }) => {
      const c = quote(name);
      return [
        `typeof(${c})`,
        `CASE typeof(${c}) WHEN 'text' THEN substr(${c}, 1, ${textLimit}) WHEN 'blob' THEN substr(${c}, 1, ${blobLimit}) ELSE ${c} END`,
        `length(${c})`,
      ];
    })
    .join(', ');
}

/**
 * A block of cells, each read as its storage class, value and full length, as tab-separated text
 * or a Markdown table: how a copy puts tables and query results on the clipboard alike. One cell
 * copies as its bare value. Stops at COPY_ROWS rows or COPY_LIMIT characters.
 */
export function copyRows(
  names: string[],
  rows: Iterable<unknown[]>,
  { markdown = false, single = false }: { markdown?: boolean; single?: boolean },
): CopiedText {
  single &&= !markdown;
  const lines: string[][] = [];
  // A Markdown table aligns a column of numbers to the right.
  const numbers = names.map(() => ({ some: false, only: true }));
  let size = 0;
  let stopped = false;
  let cut = false;
  for (const row of rows) {
    if (lines.length === COPY_ROWS) {
      stopped = true;
      break;
    }
    const fields: string[] = [];
    for (let c = 0; c < names.length; c++) {
      const kind = row[c * 3] as string;
      const text = copyText(kind, row[c * 3 + 1]);
      cut ||= Number(row[c * 3 + 2]) > (kind === 'blob' ? COPY_LIMIT / 2 : COPY_LIMIT);
      fields.push(markdown ? markdownCell(text) : single ? text : tsvField(text));
      if (kind === 'integer' || kind === 'real') numbers[c].some = true;
      else if (kind !== 'null') numbers[c].only = false;
    }
    const length = fields.reduce((sum, field) => sum + field.length, 0);
    const line = markdown ? length + 3 * fields.length + 1 : length + fields.length - 1;
    if (lines.length > 0 && size + line > COPY_LIMIT) {
      stopped = true;
      break;
    }
    lines.push(fields);
    size += line + 1;
  }
  const text = markdown
    ? markdownTable(
        names,
        lines,
        numbers.map(({ some, only }) => some && only),
        COPY_LIMIT,
      )
    : lines.map((fields) => fields.join('\t')).join('\n');
  return { text, rows: lines.length, cells: lines.length * names.length, stopped, cut };
}

/** One value as copied: NULL as nothing, numbers as the grid shows them, BLOBs as hex. */
export function copyText(kind: string, value: unknown): string {
  switch (kind) {
    case 'null':
      return '';
    case 'real':
      return realText(value as number);
    case 'blob':
      // An empty BLOB comes back as null.
      return value ? Buffer.from(value as Uint8Array).toString('hex') : '';
    default:
      return String(value);
  }
}

/** One cell as it travels to the webview: JSON-safe, exact, and short. */
export function encode(kind: string, value: unknown, length: unknown): CellValue {
  switch (kind) {
    case 'null':
      return null;
    case 'integer': {
      const big = value as bigint;
      return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(big)
        : big.toString();
    }
    case 'real': {
      const real = value as number;
      return Number.isFinite(real) ? real : String(real);
    }
    case 'text': {
      const full = Number(length);
      return full > TEXT_LIMIT ? { text: value as string, length: full } : (value as string);
    }
    case 'blob': {
      // An empty BLOB comes back as null.
      const bytes = value as Uint8Array | null;
      return { size: Number(length), head: bytes ? Buffer.from(bytes).toString('hex') : '' };
    }
    default:
      return String(value);
  }
}
