import { describe, expect, it } from 'vitest';
import { viewerStrings } from '../../src/extension/strings';
import {
  cellsText,
  composeReference,
  inlineSql,
  quote,
  sqlBlock,
  sqlName,
} from '../../src/shared/reference';
import { PLAIN_VIEW, type RowView } from '../../src/shared/rowFilter';
import { gridLocation, sourceLocation, type GridPlace } from '../../src/webview/reference';

// Templates keep their placeholders, as the webview gets them.
const strings = viewerStrings({ t: (message) => message });

describe('composeReference', () => {
  it('names the file, then the place, then what is there', () => {
    expect(composeReference('data/music.sqlite', 'table "albums"')).toBe(
      'data/music.sqlite, table "albums"',
    );
    expect(composeReference('data/music.sqlite', 'table "albums", rowid 5', '> Blue Train')).toBe(
      'data/music.sqlite, table "albums", rowid 5:\n> Blue Train',
    );
  });

  it('is the file alone without a place', () => {
    expect(composeReference('music.sqlite', '')).toBe('music.sqlite');
  });
});

describe('quote', () => {
  it('quotes every line, keeping blank ones', () => {
    expect(quote('Blue Train')).toBe('> Blue Train');
    expect(quote('one\r\n\ntwo')).toBe('> one\n>\n> two');
  });
});

describe('sqlName', () => {
  it('quotes names as SQL does', () => {
    expect(sqlName('albums')).toBe('"albums"');
    expect(sqlName('say "hi"')).toBe('"say ""hi"""');
  });
});

describe('inlineSql', () => {
  it('puts a statement on one line without its comments', () => {
    expect(inlineSql('SELECT name -- the artist\nFROM artists\n  /* all */ ORDER BY name;\n')).toBe(
      '`SELECT name FROM artists ORDER BY name`',
    );
  });

  it('keeps quoted text as it is', () => {
    expect(inlineSql('SELECT \'a  -- b\', "x  y", [p  q] FROM t')).toBe(
      '`SELECT \'a  -- b\', "x  y", [p  q] FROM t`',
    );
  });

  it('fences backticks inside with more of them', () => {
    expect(inlineSql('SELECT `name` FROM t')).toBe('`` SELECT `name` FROM t ``');
  });
});

describe('sqlBlock', () => {
  it('fences a statement as SQL', () => {
    expect(sqlBlock('CREATE TABLE t (a)\n')).toBe('```sql\nCREATE TABLE t (a)\n```');
    expect(sqlBlock("CREATE TABLE t (a DEFAULT '```')")).toBe(
      "````sql\nCREATE TABLE t (a DEFAULT '```')\n````",
    );
  });
});

describe('cellsText', () => {
  const range = { start: 4, total: 10, firstColumn: 1, lastColumn: 1, count: 1 };
  it('quotes one value and leaves a block as copied', () => {
    expect(cellsText(range, 'Blue Train')).toBe('> Blue Train');
    expect(cellsText({ ...range, count: 2 }, '| a |')).toBe('| a |');
    expect(cellsText({ ...range, lastColumn: 2 }, '| a |')).toBe('| a |');
  });

  it('adds nothing for an empty value', () => {
    expect(cellsText(range, '')).toBeUndefined();
  });
});

describe('gridLocation', () => {
  const columns = ['id', 'title', 'artist_id', 'price'];
  const rowids = ['3', '5', '8', '9', '12'];
  const place = (selection: GridPlace['selection'], more: Partial<GridPlace> = {}): GridPlace => ({
    source: { type: 'table', name: 'albums' },
    selection,
    total: rowids.length,
    columns,
    view: PLAIN_VIEW,
    rowid: (row) => rowids[row],
    ...more,
  });
  const at = (selection: GridPlace['selection'], more?: Partial<GridPlace>) =>
    gridLocation(place(selection, more), strings);

  it('names a cell by its rowid and column', () => {
    expect(at({ row1: 1, col1: 1, row2: 1, col2: 1 })).toBe(
      'table "albums", rowid 5, column "title"',
    );
  });

  it('names rows in rowid order by their first and last rowids', () => {
    expect(at({ row1: 1, col1: 1, row2: 3, col2: 3 })).toBe(
      'table "albums", rowids 5 to 9, columns "title" to "price"',
    );
  });

  it('leaves out all of the columns, or all of the rows', () => {
    expect(at({ row1: 2, col1: 0, row2: 2, col2: 3 })).toBe('table "albums", rowid 8');
    expect(at({ row1: 0, col1: 3, row2: 4, col2: 3 })).toBe('table "albums", column "price"');
    expect(at({ row1: 0, col1: 0, row2: 4, col2: 3 })).toBe('table "albums"');
  });

  it('names the one column of a table that has one', () => {
    expect(at({ row1: 0, col1: 0, row2: 4, col2: 0 }, { columns: ['name'] })).toBe(
      'table "albums", column "name"',
    );
  });

  it('lists the rowids of rows sorted otherwise', () => {
    const view: RowView = { order: { column: 3, descending: true }, search: '', filters: [] };
    expect(at({ row1: 0, col1: 1, row2: 2, col2: 1 }, { view })).toBe(
      'table "albums", rowids 3, 5, 8, column "title"',
    );
  });

  it('names rows by position, and how they were sorted and filtered, without rowids', () => {
    const view: RowView = { order: { column: 3, descending: true }, search: 'blue', filters: [] };
    expect(
      at(
        { row1: 0, col1: 1, row2: 2, col2: 1 },
        { view, rowid: undefined, source: { type: 'view', name: 'top' } },
      ),
    ).toBe('view "top", rows 1 to 3, sorted by "price" descending, filtered, column "title"');
    expect(at({ row1: 1, col1: 0, row2: 1, col2: 3 }, { rowid: () => undefined })).toBe(
      'table "albums", row 2',
    );
  });

  it('names a query by its statement', () => {
    expect(
      at(
        { row1: 0, col1: 1, row2: 1, col2: 2 },
        { source: { type: 'query', sql: 'SELECT *\nFROM albums;' }, rowid: undefined },
      ),
    ).toBe('result of `SELECT * FROM albums`, rows 1 to 2, columns "title" to "artist_id"');
  });

  it('is the table alone when there are no rows', () => {
    expect(at({ row1: 0, col1: 0, row2: 0, col2: 0 }, { total: 0 })).toBe('table "albums"');
  });
});

describe('sourceLocation', () => {
  it('names each kind of object', () => {
    expect(sourceLocation({ type: 'index', name: 'by_title' }, strings)).toBe('index "by_title"');
    expect(sourceLocation({ type: 'trigger', name: 'stamp' }, strings)).toBe('trigger "stamp"');
  });
});
