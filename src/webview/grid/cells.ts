import type { CellValue } from '../../shared/protocol';
import { formatBytes } from '../../shared/units';
import { realText } from '../../shared/values';

/** SQLite's names for the storage classes, by the letter rows carry them as. */
export const STORAGE_CLASSES: Record<string, string> = {
  n: 'NULL',
  i: 'INTEGER',
  f: 'REAL',
  t: 'TEXT',
  b: 'BLOB',
};

/** What a BLOB holds, told from its first bytes; undefined when it isn't a known kind. */
export function blobKind(head: string): string | undefined {
  const starts = (hex: string) => head.startsWith(hex);
  if (starts('89504e470d0a1a0a')) return 'PNG';
  if (starts('ffd8ff')) return 'JPEG';
  if (starts('47494638')) return 'GIF';
  if (starts('52494646') && head.slice(16, 24) === '57454250') return 'WebP';
  if (starts('1f8b')) return 'gzip';
  if (/^78(01|5e|9c|da)/.test(head)) return 'zlib';
  if (starts('4750')) return 'GeoPackage geometry';
  if (starts('53514c69746520666f726d6174203300')) return 'SQLite';
  if (starts('504b0304')) return 'ZIP';
  if (starts('25504446')) return 'PDF';
  return undefined;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Line breaks and tabs would hide in a one-line cell, so they show as symbols. */
function oneLine(text: string): string {
  return escapeHtml(text)
    .replace(/\r\n|\r|\n/g, '<span class="nl-ws">↵</span>')
    .replace(/\t/g, '<span class="nl-ws">→</span>');
}

/**
 * A cell's inner HTML and the class that aligns and colors it. `type` is the value's storage
 * class: n (NULL), i (integer), f (real), t (text) or b (BLOB).
 */
export function renderCell(
  value: CellValue,
  type: string,
  locale: string,
): { html: string; className: string } {
  switch (type) {
    case 'n':
      return { html: 'NULL', className: 'nl-null' };
    case 'i':
      return { html: escapeHtml(String(value)), className: 'nl-number' };
    case 'f': {
      const text = typeof value === 'number' ? realText(value) : String(value);
      return { html: escapeHtml(text), className: 'nl-number' };
    }
    case 'b': {
      const blob = value as { size: number; head: string };
      const kind = blobKind(blob.head) ?? 'BLOB';
      return {
        html: `${escapeHtml(kind)} · ${formatBytes(blob.size, locale)}`,
        className: 'nl-blob',
      };
    }
    default: {
      if (value !== null && typeof value === 'object' && 'text' in value) {
        return { html: `${oneLine(value.text)}…`, className: '' };
      }
      return { html: oneLine(String(value ?? '')), className: '' };
    }
  }
}

/** The text a cell shows, as plain text: for measuring columns and for the status bar. */
export function cellText(value: CellValue, type: string, locale: string): string {
  switch (type) {
    case 'n':
    case 'i':
    case 'f':
    case 'b':
      // No markup or entities in these.
      return renderCell(value, type, locale).html;
    default: {
      const text =
        value !== null && typeof value === 'object' && 'text' in value
          ? `${value.text}…`
          : String(value ?? '');
      return text.replace(/\r\n|\r|\n/g, '↵').replace(/\t/g, '→');
    }
  }
}
