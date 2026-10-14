import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { filterValue, viewClauses } from '../../src/extension/database/rowView';
import { TableReader } from '../../src/extension/database/rows';
import { viewRows } from '../../src/extension/database/sortedRows';
import { isFiltered, isPlain, parseFilter, type RowView } from '../../src/shared/rowFilter';

const sample = new DatabaseSync('test/fixtures/sample.sqlite', { readOnly: true });
afterAll(() => sample.close());

const view = (partial: Partial<RowView>): RowView => ({
  order: null,
  search: '',
  filters: [],
  ...partial,
});

/** A table's rows as `partial` shows them, worked out to the end. */
const rows = (table: string, partial: Partial<RowView>) => {
  const result = viewRows(sample, new TableReader(sample, table), view(partial));
  while (result.step(50).end === null);
  return result;
};

const column = (result: ReturnType<typeof rows>, index: number) =>
  result.page(0, 1000).rows.map((row) => row[index]);

describe('parseFilter', () => {
  it('reads comparisons, NULL tests and text to find', () => {
    expect(parseFilter('')).toBeUndefined();
    expect(parseFilter('   ')).toBeUndefined();
    expect(parseFilter('blue')).toEqual({ op: 'contains', value: 'blue' });
    expect(parseFilter(' >= 10 ')).toEqual({ op: '>=', value: '10' });
    expect(parseFilter('=Ankara')).toEqual({ op: '=', value: 'Ankara' });
    expect(parseFilter('!=0')).toEqual({ op: '<>', value: '0' });
    expect(parseFilter('=null')).toEqual({ op: 'null' });
    expect(parseFilter('<> NULL')).toEqual({ op: 'notNull' });
    expect(parseFilter('>NULL')).toEqual({ op: '>', value: 'NULL' });
    expect(parseFilter('=')).toEqual({ op: '=', value: '' });
  });

  it('tells views that change nothing from ones that sort or leave rows out', () => {
    expect(isPlain(view({ filters: ['', ' '] }))).toBe(true);
    expect(isPlain(view({ order: { column: 0, descending: false } }))).toBe(false);
    expect(isFiltered(view({ order: { column: 0, descending: false } }))).toBe(false);
    expect(isFiltered(view({ search: 'x' }))).toBe(true);
    expect(isFiltered(view({ filters: ['', '>3'] }))).toBe(true);
  });
});

describe('viewClauses', () => {
  const columns = new TableReader(sample, 'albums').info.columns;

  it('binds numbers as numbers and finds text literally', () => {
    expect(filterValue('10')).toBe(10);
    expect(filterValue('-2.5')).toBe(-2.5);
    expect(filterValue('9007199254740993')).toBe(9007199254740993n);
    expect(filterValue('007x')).toBe('007x');
    const { where, params, order } = viewClauses(
      columns,
      view({ filters: ['', '', '50%_off', '', '>9'], order: { column: 4, descending: true } }),
    );
    expect(where).toBe(`WHERE "title" LIKE ? ESCAPE '\\' AND "price" > ?`);
    expect(params).toEqual(['%50\\%\\_off%', 9]);
    expect(order).toBe('"price" DESC');
  });
});

describe('viewRows', () => {
  it('sorts a rowid table by a column either way, NULL first as SQLite sorts', () => {
    const up = rows('albums', { order: { column: 4, descending: false } });
    expect(up.progress).toEqual({ rows: 5, end: 'done' });
    expect(column(up, 4)).toEqual([null, 7.25, 9.99, 12.5, 14]);
    expect(up.page(0, 5).rowids).toEqual(['5', '3', '1', '2', '4']);
    expect(column(rows('albums', { order: { column: 4, descending: true } }), 4)).toEqual([
      14,
      12.5,
      9.99,
      7.25,
      null,
    ]);
  });

  it('filters by column and searches every column', () => {
    expect(column(rows('albums', { filters: ['', '', '', '', '>9'] }), 2)).toEqual([
      'Pastel Blues',
      '2023',
      'Kind of Blue',
    ]);
    expect(column(rows('albums', { filters: ['', '', '', '', '=NULL'] }), 2)).toEqual([
      'Homogenic',
    ]);
    // "blue" in a title, case aside; the cover BLOBs are passed over.
    expect(column(rows('albums', { search: 'BLUE' }), 2)).toEqual(['Pastel Blues', 'Kind of Blue']);
    expect(rows('albums', { search: 'nothing like this' }).progress).toEqual({
      rows: 0,
      end: 'done',
    });
  });

  it('reads the rows of a large table by rowid, anywhere, and copies them in order', () => {
    const sorted = rows('events', { order: { column: 0, descending: true } });
    expect(sorted.progress).toEqual({ rows: 5000, end: 'done' });
    expect(sorted.page(4998, 10)).toMatchObject({ start: 4998, end: true });
    expect(sorted.page(4998, 10).rowids).toEqual(['2', '1']);
    const copied = sorted.copy({ start: 0, count: 3, total: 5000, firstColumn: 0, lastColumn: 0 });
    expect(copied.text).toBe('5000\n4999\n4998');
    expect(sorted.cell(1, 0)).toEqual({ type: 'i', text: '4999', length: 4 });
  });

  it('keeps the rows themselves for views', () => {
    const titles = rows('album_list', { order: { column: 0, descending: true } });
    expect(titles.info).toMatchObject({ name: 'album_list', hasRowid: false });
    expect(titles.page(0, 1).rows[0][0]).toBe('Pastel Blues');
  });
});
