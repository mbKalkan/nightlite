import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ExportRun,
  csvField,
  exportStatement,
  jsonValue,
} from '../../src/extension/database/exportRows';
import { QueryRefused } from '../../src/extension/database/query';
import { TableReader } from '../../src/extension/database/rows';
import type { ExportFormat, ExportSource } from '../../src/shared/protocol';

const sample = new DatabaseSync('test/fixtures/sample.sqlite', { readOnly: true });
afterAll(() => sample.close());

const reader = (name: string) => new TableReader(sample, name);

/** An export's whole text, read in small chunks as the host would in big ones. */
function exported(source: ExportSource, format: ExportFormat, bytes = 64): string {
  const run = new ExportRun(sample, exportStatement(source, reader), format);
  let text = '';
  for (;;) {
    const chunk = run.next(bytes, 1000);
    text += chunk.text;
    if (chunk.done) return text;
  }
}

const plain = { order: null, search: '', filters: [] };

describe('csvField and jsonValue', () => {
  it('write each kind of value exactly', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(9007199254740993n)).toBe('9007199254740993');
    expect(csvField(42)).toBe('42.0');
    expect(csvField('a "quoted", line\nbreak')).toBe('"a ""quoted"", line\nbreak"');
    expect(csvField(new Uint8Array([0, 255]))).toBe('00ff');
    expect(jsonValue(9007199254740993n)).toBe('9007199254740993');
    expect(jsonValue(42)).toBe('42.0');
    expect(jsonValue(Infinity)).toBe('"Infinity"');
    expect(jsonValue('İstanbul "x"')).toBe('"İstanbul \\"x\\""');
  });
});

describe('ExportRun', () => {
  it('writes a table as CSV with a header, every value whole', () => {
    const csv = exported({ table: 'value_kinds', view: plain }, 'csv');
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('id,label,value');
    expect(lines[4]).toBe('4,integer beyond 2^53,9007199254740993');
    expect(lines[3]).toBe('3,whole real,42.0');
    expect(csv).toContain('10,multi-line text,"first line\nsecond line\n\tindented"\r\n');
    // The long text, all 11,200 characters of it.
    expect(csv).toMatch(/\r\n12,long text,(Lorem ipsum dolor sit amet\. ){400}\r\n/);
    expect(csv.endsWith('18,null,\r\n')).toBe(true);
  });

  it('writes JSON that reads back, big integers to the last digit', () => {
    const json = exported({ table: 'value_kinds', view: plain }, 'json');
    expect(json).toMatch(/^\[\n {2}\{"id": 1, "label": "integer", "value": 42\},\n/);
    expect(json).toContain('"value": 9007199254740993}');
    const rows = JSON.parse(json) as { label: string; value: unknown }[];
    expect(rows).toHaveLength(18);
    expect(rows.find((row) => row.label === 'PNG blob')?.value).toMatch(/^89504e47/);
    expect(rows.find((row) => row.label === 'null')?.value).toBeNull();
  });

  it('exports the rows as shown: sorted and filtered', () => {
    const csv = exported(
      {
        table: 'albums',
        view: {
          order: { column: 4, descending: true },
          search: '',
          filters: ['', '', '', '>1970'],
        },
      },
      'csv',
    );
    expect(csv.split('\r\n').map((line) => line.split(',')[2])).toEqual([
      'title',
      '2023',
      'Gülümse',
      'Homogenic',
      undefined,
    ]);
  });

  it('exports every row of a query, its names made unique as JSON keys', () => {
    expect(exported({ sql: 'SELECT 1 AS a, 2 AS a' }, 'json')).toBe('[\n  {"a": 1, "a_2": 2}\n]\n');
    expect(exported({ sql: 'SELECT * FROM albums WHERE 0' }, 'json')).toBe('[]\n');
    expect(exported({ sql: 'SELECT * FROM albums WHERE 0' }, 'csv').split('\r\n')[0]).toMatch(
      /^id,artist_id,title/,
    );
    expect(() => exported({ sql: 'DELETE FROM albums' }, 'csv')).toThrow(QueryRefused);
  });
});
