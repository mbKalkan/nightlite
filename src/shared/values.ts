/** The most text a copy puts on the clipboard, in characters; BLOBs count twice, as hex. */
export const COPY_LIMIT = 16 * 1024 * 1024;
/** The most rows a copy holds, about what a spreadsheet takes; Export is for more. */
export const COPY_ROWS = 1_000_000;
/** How much of a value the cell detail shows: a megabyte of text, 4 KB of a BLOB in hex. */
export const DETAIL_TEXT = 1024 * 1024;
export const DETAIL_BYTES = 4096;

/** A REAL as text: one that happens to be whole still reads as a real, as SQLite prints it. */
export function realText(value: number): string {
  return Number.isInteger(value) && Math.abs(value) < 1e21 ? value.toFixed(1) : String(value);
}

/** A field of tab-separated text, quoted the way spreadsheets read it when it has to be. */
export function tsvField(text: string): string {
  return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
