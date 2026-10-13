// Light syntax coloring for the CREATE statements SQLite keeps in its schema.

const KEYWORDS = new Set(
  `ABORT ACTION AFTER ALL ALWAYS AND AS ASC AUTOINCREMENT BEFORE BEGIN BETWEEN BLOB BY CASCADE CASE
  CAST CHECK COLLATE CONFLICT CONSTRAINT CREATE CROSS CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP
  DEFAULT DEFERRABLE DEFERRED DELETE DESC DISTINCT EACH ELSE END EXISTS FAIL FOR FOREIGN FROM
  GENERATED GLOB GROUP HAVING IF IGNORE IMMEDIATE IN INDEX INITIALLY INNER INSERT INSTEAD INTEGER
  INTO IS JOIN KEY LEFT LIKE LIMIT MATCH NATURAL NO NOT NULL NUMERIC OF OFFSET ON OR ORDER OUTER
  PRIMARY REAL REFERENCES REPLACE RESTRICT ROLLBACK ROW ROWID SELECT SET STORED STRICT TABLE TEMP
  TEMPORARY TEXT THEN TRIGGER UNION UNIQUE UPDATE USING VALUES VIEW VIRTUAL WHEN WHERE WITH WITHOUT`.split(
    /\s+/,
  ),
);

const TOKEN =
  /(--[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?|`[^`]*`?|\[[^\]]*\]?)|(\b(?:0x[0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b)|([a-z_][a-z0-9_$]*)/gi;

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The statement as HTML, with comments, strings, quoted names, numbers and keywords in spans. */
export function highlightSql(sql: string): string {
  let html = '';
  let last = 0;
  for (const match of sql.matchAll(TOKEN)) {
    const [token, comment, string, quoted, number, word] = match;
    html += escape(sql.slice(last, match.index));
    last = match.index + token.length;
    const kind = comment
      ? 'comment'
      : string
        ? 'string'
        : quoted
          ? 'name'
          : number
            ? 'number'
            : word && KEYWORDS.has(word.toUpperCase())
              ? 'keyword'
              : undefined;
    html += kind ? `<span class="nl-sql-${kind}">${escape(token)}</span>` : escape(token);
  }
  return html + escape(sql.slice(last));
}
