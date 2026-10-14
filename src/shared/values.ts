/** The most text a copy puts on the clipboard, in characters; BLOBs count twice, as hex. */
export const COPY_LIMIT = 16 * 1024 * 1024;
/** The most rows a copy holds, about what a spreadsheet takes; Export is for more. */
export const COPY_ROWS = 1_000_000;
/** How much of a value the cell detail shows: a megabyte of text, 4 KB of a BLOB in hex. */
export const DETAIL_TEXT = 1024 * 1024;
export const DETAIL_BYTES = 4096;
/** BLOBs the cell detail shows as what they hold: images up to 16 MB, text up to DETAIL_TEXT. */
export const IMAGE_PREVIEW = 16 * 1024 * 1024;
/** A query's results hold this many rows, or about this many bytes of values (D-021). */
export const QUERY_ROWS = 100_000;
export const QUERY_MEMORY = 256 * 1024 * 1024;
/** A table's rows sorted or filtered: rowids kept, eight bytes each (D-022). */
export const VIEW_ROWS = 10_000_000;

/** Image formats a webview shows, by their first bytes. */
export function imageKind(bytes: Uint8Array): 'png' | 'jpeg' | 'webp' | 'gif' | undefined {
  const at = (offset: number, ...values: number[]) =>
    values.every((value, i) => bytes[offset + i] === value);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'gif';
  return undefined;
}

/**
 * Whether bytes read as text: valid UTF-8, a character cut at the end allowed, and no control
 * characters other than line breaks and tabs.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
  } catch {
    return false;
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) {
      return false;
    }
  }
  return true;
}

/** A REAL as text: one that happens to be whole still reads as a real, as SQLite prints it. */
export function realText(value: number): string {
  return Number.isInteger(value) && Math.abs(value) < 1e21 ? value.toFixed(1) : String(value);
}

/** A field of tab-separated text, quoted the way spreadsheets read it when it has to be. */
export function tsvField(text: string): string {
  return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A value as a cell of a Markdown table, which can hold neither a pipe nor a line break. */
export function markdownCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, '<br>');
}

/** Columns are padded to line up as plain text, up to this many characters. */
const MARKDOWN_PAD = 40;

/**
 * A Markdown table of cells made with `markdownCell`, headed by `names`; `right` aligns a
 * column to the right, as numbers are. Columns line up unless that would take it over `limit`.
 */
export function markdownTable(
  names: string[],
  rows: string[][],
  right: boolean[],
  limit = Infinity,
): string {
  const header = names.map(markdownCell);
  // Characters, not UTF-16 units, so that a column of emoji lines up too.
  const length = (text: string) => [...text].length;
  const widths = header.map((name) => Math.max(3, length(name)));
  for (const row of rows) {
    row.forEach((cell, c) => (widths[c] = Math.max(widths[c], length(cell))));
  }
  for (let c = 0; c < widths.length; c++) widths[c] = Math.min(widths[c], MARKDOWN_PAD);
  let size = 0;
  for (const row of [header, ...rows]) {
    size += row.reduce((sum, cell, c) => sum + Math.max(widths[c], length(cell)) + 3, 2);
  }
  const pad = size <= limit;
  const line = (cells: string[]) =>
    `| ${cells
      .map((cell, c) => {
        if (!pad) return cell;
        const gap = ' '.repeat(Math.max(0, widths[c] - length(cell)));
        return right[c] ? gap + cell : cell + gap;
      })
      .join(' | ')} |`;
  const rule = widths.map((width, c) => {
    const dashes = '-'.repeat(pad ? width : 3);
    return right[c] ? `${dashes.slice(1)}:` : dashes;
  });
  return [
    line(header),
    `|${rule.map((dashes) => ` ${dashes} `).join('|')}|`,
    ...rows.map(line),
  ].join('\n');
}
