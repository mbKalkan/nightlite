import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { TableReader, TEXT_LIMIT, quote } from '../../src/extension/database/rows';
import { COPY_LIMIT } from '../../src/shared/values';

const sample = new DatabaseSync('test/fixtures/sample.sqlite', { readOnly: true });
const scratch = mkdtempSync(join(tmpdir(), 'nightlite-rows-'));
afterAll(() => {
  sample.close();
  rmSync(scratch, { recursive: true, force: true });
});

const valueOf = (reader: TableReader, label: string) => {
  const page = reader.page(0, 100, 100);
  const index = page.rows.findIndex((row) => row[1] === label);
  return { value: page.rows[index][2], type: page.types[index][2] };
};

describe('TableReader', () => {
  it('describes columns, rowids and the row estimate', () => {
    const reader = new TableReader(sample, 'albums');
    expect(reader.info.hasRowid).toBe(true);
    expect(reader.info.estimate).toBe(5);
    expect(reader.info.columns.map((c) => c.name)).toEqual([
      'id',
      'artist_id',
      'title',
      'released',
      'price',
      'cover',
      'details',
      'rating',
    ]);
    expect(reader.info.columns[0]).toMatchObject({ type: 'INTEGER', primaryKey: 1 });
    expect(reader.info.columns[2]).toMatchObject({ type: 'TEXT', notNull: true });
    expect(reader.info.columns[7]).toMatchObject({ defaultValue: '0' });
    expect(reader.count()).toBe(5);
  });

  it('keeps every value exact and short enough to send', () => {
    const reader = new TableReader(sample, 'value_kinds');
    expect(valueOf(reader, 'integer')).toEqual({ value: 42, type: 'i' });
    expect(valueOf(reader, 'whole real')).toEqual({ value: 42, type: 'f' });
    expect(valueOf(reader, 'integer beyond 2^53')).toEqual({
      value: '9007199254740993',
      type: 'i',
    });
    expect(valueOf(reader, 'null')).toEqual({ value: null, type: 'n' });
    expect(valueOf(reader, 'empty blob')).toEqual({ value: { size: 0, head: '' }, type: 'b' });
    expect(valueOf(reader, 'blob')).toEqual({
      value: { size: 6, head: '0001027f80ff' },
      type: 'b',
    });
    const long = valueOf(reader, 'long text');
    expect(long.type).toBe('t');
    expect(long.value).toMatchObject({ length: 11200 });
    expect((long.value as { text: string }).text).toHaveLength(TEXT_LIMIT);
    expect(valueOf(reader, 'PNG blob').value).toMatchObject({
      head: expect.stringMatching(/^89504e47/),
    });
  });

  it('reads pages that line up with OFFSET, however they are reached', () => {
    const reader = new TableReader(sample, 'events');
    const ids = (start: number, count: number) =>
      reader.page(start, count, 5000).rows.map((row) => row[0]);
    const byOffset = (start: number, count: number) =>
      sample
        .prepare('SELECT id FROM events ORDER BY rowid LIMIT ? OFFSET ?')
        .all(count, start)
        .map((row) => row.id);
    // A far jump, then the pages after and before it, reached from its rowids.
    expect(ids(2500, 100)).toEqual(byOffset(2500, 100));
    expect(ids(2600, 100)).toEqual(byOffset(2600, 100));
    expect(ids(2400, 100)).toEqual(byOffset(2400, 100));
    const last = reader.page(4900, 100, 5000);
    expect(last.rows).toHaveLength(100);
    expect(reader.page(4950, 100, 5000).end).toBe(true);
  });

  it('lines pages up around gaps in the rowids', () => {
    const path = join(scratch, 'gaps.db');
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE t (v INTEGER); BEGIN');
    const insert = db.prepare('INSERT INTO t (rowid, v) VALUES (?, ?)');
    for (let i = 0; i < 1000; i++) {
      // Rowids rise with gaps of one to three.
      insert.run(i * 3 + (i % 3), i);
    }
    db.exec('COMMIT');
    db.close();
    const gaps = new DatabaseSync(path, { readOnly: true });
    try {
      const reader = new TableReader(gaps, 't');
      expect(reader.info.estimate).toBeGreaterThan(1000);
      const count = reader.count();
      const first = reader.page(500, 50, count);
      const next = reader.page(550, 50, count);
      const before = reader.page(450, 50, count);
      const values = [...before.rows, ...first.rows, ...next.rows].map((row) => row[0] as number);
      // Consecutive values, no repeats or gaps across the three pages.
      expect(values).toEqual(values.map((_, i) => values[0] + i));
    } finally {
      gaps.close();
    }
  });

  it('reads views and tables without rowids by position', () => {
    const view = new TableReader(sample, 'album_list');
    expect(view.info).toMatchObject({ hasRowid: false, estimate: null });
    expect(view.page(0, 10, 10).rows).toHaveLength(5);
    expect(view.page(0, 10, 10).rowids).toBeUndefined();
    const tags = new TableReader(sample, 'tags');
    expect(tags.info.hasRowid).toBe(false);
    expect(tags.page(1, 10, 10).rows.map((row) => row[0])).toEqual(['jazz', 'pop']);
  });

  it('quotes names with spaces and quotes', () => {
    expect(quote('order items')).toBe('"order items"');
    expect(quote('a"b')).toBe('"a""b"');
    const reader = new TableReader(sample, 'order items');
    expect(reader.page(0, 10, 10).rows).toEqual([[1, 'first', 0.5]]);
  });

  it('reports an empty rowid table as having no rows', () => {
    const reader = new TableReader(sample, 'empty_table');
    expect(reader.info.estimate).toBe(0);
    expect(reader.page(0, 100, 0)).toMatchObject({ rows: [], end: true });
  });
});

describe('TableReader.copy', () => {
  const range = (
    start: number,
    count: number | null,
    firstColumn: number,
    lastColumn = firstColumn,
  ) => ({
    start,
    count,
    total: 18,
    firstColumn,
    lastColumn,
  });

  it('copies one cell as its full, bare value', () => {
    const reader = new TableReader(sample, 'value_kinds');
    // Rows are value_kinds' ids 1…18 at positions 0…17; column 2 is the value.
    expect(reader.copy(range(9, 1, 2)).text).toBe('first line\nsecond line\n\tindented');
    const long = reader.copy(range(11, 1, 2));
    expect(long.text).toHaveLength(11200);
    expect(long).toMatchObject({ rows: 1, cells: 1, stopped: false, cut: false });
    expect(reader.copy(range(3, 1, 2)).text).toBe('9007199254740993');
    expect(reader.copy(range(2, 1, 2)).text).toBe('42.0');
    expect(reader.copy(range(14, 1, 2)).text).toBe('0001027f80ff');
    expect(reader.copy(range(15, 1, 2)).text).toBe('');
    expect(reader.copy(range(17, 1, 2)).text).toBe('');
  });

  it('copies a block as tab-separated text that spreadsheets read back', () => {
    const reader = new TableReader(sample, 'value_kinds');
    const block = reader.copy(range(6, 4, 1, 2));
    expect(block.text).toBe(
      [
        'huge real\t1e+300',
        'empty text\t',
        'text that looks like a number\t007',
        'multi-line text\t"first line\nsecond line\n\tindented"',
      ].join('\n'),
    );
    expect(block).toMatchObject({ rows: 4, cells: 8, stopped: false });
  });

  it('copies the rows the grid shows, even after a far jump', () => {
    const reader = new TableReader(sample, 'events');
    const page = reader.page(2500, 100, 5000);
    const ids = reader.copy({ start: 2550, count: 3, total: 5000, firstColumn: 0, lastColumn: 0 });
    expect(ids.text.split('\n')).toEqual(page.rows.slice(50, 53).map((row) => String(row[0])));
  });

  it('copies to the end of views and tables without rowids', () => {
    const view = new TableReader(sample, 'album_list');
    const titles = view.copy({ start: 3, count: null, total: 5, firstColumn: 0, lastColumn: 0 });
    expect(titles.rows).toBe(2);
    const tags = new TableReader(sample, 'tags');
    expect(tags.copy({ start: 0, count: null, total: 3, firstColumn: 0, lastColumn: 0 }).text).toBe(
      'anadolu rock\njazz\npop',
    );
  });

  it('stops at the clipboard limit and says so', () => {
    const path = join(scratch, 'big.db');
    const db = new DatabaseSync(path);
    // Three rows of 7 M characters fit two to the limit; one of 17 M is cut.
    db.exec(`
      CREATE TABLE t (v TEXT);
      INSERT INTO t VALUES (printf('%.*c', 7000000, 'a')), (printf('%.*c', 7000000, 'b')),
        (printf('%.*c', 7000000, 'c')), (printf('%.*c', ${COPY_LIMIT + 1000}, 'd'));
    `);
    db.close();
    const big = new DatabaseSync(path, { readOnly: true });
    try {
      const reader = new TableReader(big, 't');
      const three = reader.copy({ start: 0, count: 3, total: 4, firstColumn: 0, lastColumn: 0 });
      expect(three).toMatchObject({ rows: 2, stopped: true, cut: false });
      const huge = reader.copy({ start: 3, count: 1, total: 4, firstColumn: 0, lastColumn: 0 });
      expect(huge).toMatchObject({ rows: 1, stopped: false, cut: true });
      expect(huge.text).toHaveLength(COPY_LIMIT);
    } finally {
      big.close();
    }
  });
});
