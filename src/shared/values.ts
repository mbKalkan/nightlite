/** The most text a copy puts on the clipboard, in characters; BLOBs count twice, as hex. */
export const COPY_LIMIT = 16 * 1024 * 1024;
/** The most rows a copy holds, about what a spreadsheet takes; Export is for more. */
export const COPY_ROWS = 1_000_000;
/** How much of a value the cell detail shows: a megabyte of text, 4 KB of a BLOB in hex. */
export const DETAIL_TEXT = 1024 * 1024;
export const DETAIL_BYTES = 4096;
/** BLOBs the cell detail shows as what they hold: images up to 16 MB, text up to DETAIL_TEXT. */
export const IMAGE_PREVIEW = 16 * 1024 * 1024;

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
