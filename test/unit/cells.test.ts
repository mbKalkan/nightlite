import { describe, expect, it } from 'vitest';
import { blobKind, cellText, renderCell } from '../../src/webview/grid/cells';

describe('renderCell', () => {
  it('aligns numbers and keeps reals looking like reals', () => {
    expect(renderCell(42, 'i', 'en')).toEqual({ html: '42', className: 'nl-number' });
    expect(renderCell('9007199254740993', 'i', 'en').html).toBe('9007199254740993');
    expect(renderCell(14, 'f', 'en').html).toBe('14.0');
    expect(renderCell(0.1, 'f', 'en').html).toBe('0.1');
    expect(renderCell('Infinity', 'f', 'en').html).toBe('Infinity');
  });

  it('marks NULL apart from text that says NULL', () => {
    expect(renderCell(null, 'n', 'en')).toEqual({ html: 'NULL', className: 'nl-null' });
    expect(renderCell('NULL', 't', 'en').className).toBe('');
  });

  it('escapes text and shows line breaks and tabs', () => {
    expect(renderCell('<b>a\nb\tc</b>', 't', 'en').html).toBe(
      '&lt;b&gt;a<span class="nl-ws">↵</span>b<span class="nl-ws">→</span>c&lt;/b&gt;',
    );
    expect(renderCell({ text: 'abc', length: 5000 }, 't', 'en').html).toBe('abc…');
  });

  it('names BLOBs by what they hold', () => {
    expect(renderCell({ size: 2048, head: '89504e470d0a1a0a00' }, 'b', 'en')).toEqual({
      html: 'PNG · 2 KB',
      className: 'nl-blob',
    });
    expect(renderCell({ size: 3, head: '000102' }, 'b', 'tr').html).toBe('BLOB · 3 B');
  });
});

describe('cellText', () => {
  it('gives the text a cell shows, without markup', () => {
    expect(cellText('<b>a\nb\tc</b> & co', 't', 'en')).toBe('<b>a↵b→c</b> & co');
    expect(cellText({ text: 'abc', length: 5000 }, 't', 'en')).toBe('abc…');
    expect(cellText(14, 'f', 'en')).toBe('14.0');
    expect(cellText(null, 'n', 'en')).toBe('NULL');
    expect(cellText({ size: 2048, head: '1f8b' }, 'b', 'en')).toBe('gzip · 2 KB');
  });
});

describe('blobKind', () => {
  it('recognizes the formats databases and tiles hold', () => {
    expect(blobKind('ffd8ffe0')).toBe('JPEG');
    expect(blobKind('524946460000000057454250')).toBe('WebP');
    expect(blobKind('1f8b0800')).toBe('gzip');
    expect(blobKind('789c')).toBe('zlib');
    expect(blobKind('4750000100')).toBe('GeoPackage geometry');
    expect(blobKind('53514c69746520666f726d6174203300')).toBe('SQLite');
    expect(blobKind('1a2b')).toBeUndefined();
  });
});
