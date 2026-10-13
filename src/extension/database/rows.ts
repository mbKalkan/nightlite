import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import type { CellValue, ColumnInfo, ObjectInfo, RowPage } from '../../shared/protocol';

/** Text longer than this is cut for the grid; the cell says how long it really is. */
export const TEXT_LIMIT = 1000;
/** BLOBs travel as their size and first bytes, enough to tell a PNG from a gzip. */
export const BLOB_HEAD = 48;
/** How far from a row already read the next read may start before positions are estimated. */
const NEAR = 2000;

const STORAGE_CLASSES: Record<string, string> = {
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
    const values = columns.flatMap(({ name: column }) => {
      const c = quote(column);
      return [
        `typeof(${c})`,
        `CASE typeof(${c}) WHEN 'text' THEN substr(${c}, 1, ${TEXT_LIMIT}) WHEN 'blob' THEN substr(${c}, 1, ${BLOB_HEAD}) ELSE ${c} END`,
        `length(${c})`,
      ];
    });
    this.select = `SELECT ${hasRowid ? 'rowid, ' : ''}${values.join(', ')}`;

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
    const spanSize = Number(this.span.max - this.span.min + 1n);
    const target = this.span.min + BigInt(Math.floor((start / Math.max(total, 1)) * spanSize));
    return this.read(
      `${this.select} ${this.from} WHERE rowid >= ? ORDER BY rowid LIMIT ?`,
      [target, count],
      start,
      count,
    );
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

/** One cell as it travels to the webview: JSON-safe, exact, and short. */
function encode(kind: string, value: unknown, length: unknown): CellValue {
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
