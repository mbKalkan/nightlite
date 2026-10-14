import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { QueryRefused, QueryRun } from '../../src/extension/database/query';
import { TableReader } from '../../src/extension/database/rows';
import { QUERY_ROWS } from '../../src/shared/values';

const sample = new DatabaseSync('test/fixtures/sample.sqlite', { readOnly: true });
afterAll(() => sample.close());

/** Runs a query to its end, as the host does in steps. */
const run = (sql: string, db = sample) => {
  const query = new QueryRun(db, sql);
  while (query.step(50).end === null);
  return query;
};

const COUNTER = 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n';

describe('QueryRun', () => {
  it('names the columns, with their declared types where they come straight from a table', () => {
    const query = new QueryRun(sample, 'SELECT id, title AS name, price * 2 FROM albums');
    expect(query.info.columns.map(({ name, type }) => ({ name, type }))).toEqual([
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT' },
      { name: 'price * 2', type: '' },
    ]);
    expect(query.info).toMatchObject({ hasRowid: false, estimate: null });
  });

  it('shows rows as the table grid does: exact, and short enough to send', () => {
    const query = run('SELECT * FROM value_kinds');
    expect(query.progress).toEqual({ rows: 18, end: 'done' });
    const table = new TableReader(sample, 'value_kinds').page(0, 18, 18);
    const page = query.page(0, 100);
    expect(page.rows).toEqual(table.rows);
    expect(page.types).toEqual(table.types);
    expect(page.end).toBe(true);
    expect(query.page(16, 1)).toMatchObject({ start: 16, end: false });
  });

  it('copies and shows cells in full, from the rows kept', () => {
    const query = run('SELECT label, value FROM value_kinds');
    const block = (start: number, count: number | null, markdown = false) =>
      query.copy({ start, count, total: 18, firstColumn: 0, lastColumn: 1, markdown }).text;
    expect(block(8, 2)).toBe(
      'text that looks like a number\t007\nmulti-line text\t"first line\nsecond line\n\tindented"',
    );
    expect(block(0, 2, true)).toBe(
      [
        '| label            | value |',
        '| ---------------- | ----: |',
        '| integer          |    42 |',
        '| negative integer |    -7 |',
      ].join('\n'),
    );
    expect(block(16, null).split('\n')).toHaveLength(2);

    const long = query.cell(11, 1);
    expect(long).toMatchObject({ type: 't', length: 11200 });
    expect(long.text).toHaveLength(11200);
    expect(query.cell(3, 1)).toEqual({ type: 'i', text: '9007199254740993', length: 0 });
    const png = query.cell(16, 1);
    expect(png).toMatchObject({ type: 'b', length: 84 });
    expect(png.text).toMatch(/^89504e47/);
    expect(png.bytes).toHaveLength(84);
    expect(query.cell(14, 1).bytes).toBeUndefined();
  });

  it('stops at the rows results hold, and tells a query that had exactly that many', () => {
    const endless = run(`${COUNTER}) SELECT i FROM n`);
    expect(endless.progress).toEqual({ rows: QUERY_ROWS, end: 'limit' });
    expect(endless.page(QUERY_ROWS - 1, 10).rows).toEqual([[QUERY_ROWS]]);
    expect(run(`${COUNTER} WHERE i < ${QUERY_ROWS}) SELECT i FROM n`).progress).toEqual({
      rows: QUERY_ROWS,
      end: 'done',
    });
  });

  it('reads in steps, and keeps what it read when stopped', () => {
    const query = new QueryRun(sample, `${COUNTER}) SELECT i FROM n`);
    expect(query.step(0)).toEqual({ rows: 1, end: null });
    expect(query.step(0)).toEqual({ rows: 2, end: null });
    expect(query.stop()).toEqual({ rows: 2, end: 'done' });
    expect(query.step(50)).toEqual({ rows: 2, end: 'done' });
    expect(query.page(0, 10).rows).toEqual([[1], [2]]);
  });

  it('runs only statements that read, and says why SQLite turned one down', () => {
    expect(() => new QueryRun(sample, 'DELETE FROM albums')).toThrow(QueryRefused);
    expect(() => new QueryRun(sample, "VACUUM INTO 'copy.db'")).toThrow(QueryRefused);
    expect(() => new QueryRun(sample, 'SELECT 1; SELECT 2')).toThrow(
      expect.objectContaining({ reason: 'several' }),
    );
    expect(() => new QueryRun(sample, 'SELECT * FROM missing')).toThrow(/no such table: missing/);
    expect(run('PRAGMA table_info(albums)').progress.rows).toBe(8);
  });
});
