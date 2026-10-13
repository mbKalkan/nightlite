import { describe, expect, it } from 'vitest';
import { formatJson, hexDump } from '../../src/webview/detail/format';

/** The text the HTML shows. */
const plain = (html: string | undefined) =>
  html
    ?.replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

describe('formatJson', () => {
  it('indents objects and arrays and colors their parts', () => {
    const html = formatJson('{"a":1,"b":[true,null,"x"],"c":{}}');
    expect(plain(html)).toBe(
      [
        '{',
        '  "a": 1,',
        '  "b": [',
        '    true,',
        '    null,',
        '    "x"',
        '  ],',
        '  "c": {}',
        '}',
      ].join('\n'),
    );
    expect(html).toContain('<span class="nl-json-key">&quot;a&quot;</span>');
    expect(html).toContain('<span class="nl-json-number">1</span>');
    expect(html).toContain('<span class="nl-json-literal">true</span>');
    expect(html).toContain('<span class="nl-json-string">&quot;x&quot;</span>');
  });

  it('keeps numbers as written and escapes markup', () => {
    expect(plain(formatJson('[9007199254740993, 1.50e3]'))).toBe(
      '[\n  9007199254740993,\n  1.50e3\n]',
    );
    expect(formatJson('{"<b>":"a\\"&"}')).toContain('&quot;&lt;b&gt;&quot;');
  });

  it('leaves alone what is not a JSON object or array', () => {
    expect(formatJson('42')).toBeUndefined();
    expect(formatJson('"text"')).toBeUndefined();
    expect(formatJson('{not json}')).toBeUndefined();
    expect(formatJson('plain text')).toBeUndefined();
  });
});

describe('hexDump', () => {
  it('lays bytes out with offsets and their printable characters', () => {
    const png = '89504e470d0a1a0a0000000d4948445200';
    expect(hexDump(png).split('\n')).toEqual([
      '00000000  89 50 4e 47 0d 0a 1a 0a  .PNG....',
      '00000008  00 00 00 0d 49 48 44 52  ....IHDR',
      '00000010  00                       .',
    ]);
    expect(hexDump('')).toBe('');
  });
});
