import { describe, expect, it } from 'vitest';
import { highlightSql } from '../../src/webview/sql';

describe('highlightSql', () => {
  it('marks keywords, names, strings, numbers and comments', () => {
    const html = highlightSql(
      `CREATE TABLE "order items" (id INTEGER, note TEXT DEFAULT 'x''y', n REAL DEFAULT 1.5) -- done`,
    );
    expect(html).toContain('<span class="nl-sql-keyword">CREATE</span>');
    expect(html).toContain('<span class="nl-sql-name">"order items"</span>');
    expect(html).toContain(`<span class="nl-sql-string">'x''y'</span>`);
    expect(html).toContain('<span class="nl-sql-number">1.5</span>');
    expect(html).toContain('<span class="nl-sql-comment">-- done</span>');
    // Plain column names stay plain.
    expect(html).toContain(' note ');
  });

  it('escapes HTML everywhere, inside tokens too', () => {
    const html = highlightSql(`CREATE VIEW v AS SELECT '<b>' AS "<i>" WHERE 1 < 2 /* <x> */`);
    expect(html).not.toMatch(/<(b|i|x)>/);
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain(' &lt; ');
  });

  it('keeps text it does not understand, unterminated strings included', () => {
    const sql = `SELECT 'open`;
    const text = highlightSql(sql).replace(/<[^>]+>/g, '');
    expect(text).toBe(sql);
  });
});
