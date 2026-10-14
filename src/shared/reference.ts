import type { CopyRange } from './protocol';

/**
 * A copied reference names the file, then the place in it, then what is there, so that it reads
 * well when pasted into a chat with an AI assistant or into a note (D-026):
 *
 *     data/music.sqlite, table "albums", rowid 5, column "title":
 *     > Blue Train
 *
 * With no place, as on a file's overview, it's the file alone.
 */
export function composeReference(file: string, location: string, text?: string): string {
  const head = location ? `${file}, ${location}` : file;
  return text ? `${head}:\n${text}` : head;
}

/** A value quoted the Markdown way: `> ` before each line, blank lines kept as part of it. */
export function quote(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

/** A table's, view's or column's name as SQL quotes it, so that any name reads back exactly. */
export function sqlName(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * A statement as inline code on one line: comments left out, and runs of whitespace outside
 * quotes made one space, so that it still runs as it did.
 */
export function inlineSql(sql: string): string {
  let line = '';
  let i = 0;
  const space = () => {
    if (line && !line.endsWith(' ')) line += ' ';
  };
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) {
      space();
      i++;
    } else if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      space();
      i = end < 0 ? sql.length : end + 1;
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      space();
      i = end < 0 ? sql.length : end + 2;
    } else if (c === "'" || c === '"' || c === '`' || c === '[') {
      // Quotes are escaped by doubling them, so the next lone one closes; brackets can't nest.
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      while (j < sql.length) {
        if (close !== ']' && sql[j] === close && sql[j + 1] === close) j += 2;
        else if (sql[j] === close) break;
        else j++;
      }
      line += sql.slice(i, j + 1);
      i = j + 1;
    } else {
      line += c;
      i++;
    }
  }
  line = line.trim().replace(/[\s;]+$/, '');
  // Inline code is fenced by one backtick more than the longest run inside it.
  const longest = Math.max(0, ...(line.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = longest > 0 ? ' ' : '';
  return `${fence}${pad}${line}${pad}${fence}`;
}

/** A statement as a fenced block of SQL, as the schema shows it. */
export function sqlBlock(sql: string): string {
  const longest = Math.max(2, ...(sql.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}sql\n${sql.trim()}\n${fence}`;
}

/**
 * What copied cells add to a reference: one value quoted, a block as the Markdown table it was
 * copied as; nothing for an empty value.
 */
export function cellsText(range: CopyRange, text: string): string | undefined {
  if (text === '') return undefined;
  const single = range.count === 1 && range.firstColumn === range.lastColumn;
  return single ? quote(text) : text;
}
