import { describe, expect, it } from 'vitest';
import {
  imageKind,
  looksLikeText,
  markdownCell,
  markdownTable,
  realText,
  tsvField,
} from '../../src/shared/values';

describe('realText', () => {
  it('keeps whole reals looking like reals', () => {
    expect(realText(14)).toBe('14.0');
    expect(realText(-3)).toBe('-3.0');
    expect(realText(0.1)).toBe('0.1');
    expect(realText(1e300)).toBe('1e+300');
    expect(realText(Infinity)).toBe('Infinity');
  });
});

describe('tsvField', () => {
  it('quotes only fields that would break the rows or columns', () => {
    expect(tsvField('plain text')).toBe('plain text');
    expect(tsvField('a\tb')).toBe('"a\tb"');
    expect(tsvField('line\nbreak')).toBe('"line\nbreak"');
    expect(tsvField('say "hi"')).toBe('"say ""hi"""');
  });
});

describe('imageKind', () => {
  it('tells the pictures a webview shows by their first bytes', () => {
    const bytes = (...values: number[]) => new Uint8Array(values);
    expect(imageKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d))).toBe('png');
    expect(imageKind(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
    expect(imageKind(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8'))).toBe('webp');
    expect(imageKind(new TextEncoder().encode('GIF89a'))).toBe('gif');
    expect(imageKind(bytes(0x1f, 0x8b))).toBeUndefined();
    expect(imageKind(bytes())).toBeUndefined();
  });
});

describe('looksLikeText', () => {
  const text = (value: string) => new TextEncoder().encode(value);

  it('reads UTF-8 with line breaks and tabs as text', () => {
    expect(looksLikeText(text('{"a": 1}\n\tİstanbul 🌙\r\n'))).toBe(true);
    // A character cut at the end, as the first bytes of a longer value can be.
    expect(looksLikeText(text('gece 🌙').subarray(0, 7))).toBe(true);
  });

  it('turns down binary data', () => {
    expect(looksLikeText(new Uint8Array([0, 1, 2, 127]))).toBe(false);
    expect(looksLikeText(new Uint8Array([0xc3, 0x28]))).toBe(false);
    expect(looksLikeText(text('a\u0007b'))).toBe(false);
    expect(looksLikeText(new Uint8Array())).toBe(false);
  });
});

describe('markdownTable', () => {
  it('lines columns up, numbers to the right, and keeps pipes and line breaks in their cells', () => {
    const rows = [
      ['1', markdownCell('Ada')],
      ['22', markdownCell('Grace | Hopper')],
      ['333', markdownCell('two\r\nlines')],
    ];
    expect(markdownTable(['id', 'name'], rows, [true, false])).toBe(
      [
        '|  id | name            |',
        '| --: | --------------- |',
        '|   1 | Ada             |',
        '|  22 | Grace \\| Hopper |',
        '| 333 | two<br>lines    |',
      ].join('\n'),
    );
  });

  it('pads a column only so far, and not at all when that would make the table too big', () => {
    const long = 'x'.repeat(60);
    expect(markdownTable(['a', 'b'], [[long, 'y']], [false, false]).split('\n')[0]).toBe(
      `| a${' '.repeat(39)} | b   |`,
    );
    expect(markdownTable(['a'], [['1']], [true], 10)).toBe('| a |\n| --: |\n| 1 |');
  });
});
