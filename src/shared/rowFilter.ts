/**
 * What a column's filter box asks for (D-022): `=NULL` and `<>NULL`, a comparison like `>10`,
 * `=Ankara` or `<>0`, or else text the value contains.
 */
export type FilterTest =
  | { op: 'null' | 'notNull' }
  | { op: '=' | '<>' | '<' | '<=' | '>' | '>='; value: string }
  | { op: 'contains'; value: string };

export function parseFilter(text: string | null | undefined): FilterTest | undefined {
  // A view kept from before may have no filter for a column.
  const trimmed = (text ?? '').trim();
  if (trimmed === '') return undefined;
  const match = /^(<=|>=|<>|!=|=|<|>)\s*(.*)$/s.exec(trimmed);
  if (!match) return { op: 'contains', value: trimmed };
  const op = match[1] === '!=' ? '<>' : (match[1] as '=' | '<>' | '<' | '<=' | '>' | '>=');
  const value = match[2];
  if (/^null$/i.test(value) && (op === '=' || op === '<>')) {
    return { op: op === '=' ? 'null' : 'notNull' };
  }
  return { op, value };
}

/** How rows are shown: sorted by a column, and filtered by text in any column or per column. */
export interface RowView {
  /** The column rows are sorted by, and which way; null keeps the table's own order. */
  order: { column: number; descending: boolean } | null;
  /** Text to find in any column; '' for none. */
  search: string;
  /** Each column's filter, by column; '' for none. */
  filters: string[];
}

export const PLAIN_VIEW: RowView = { order: null, search: '', filters: [] };

/** Whether rows show as the table holds them, with nothing sorted or filtered. */
export function isPlain(view: RowView): boolean {
  return (
    view.order === null &&
    view.search.trim() === '' &&
    view.filters.every((filter) => parseFilter(filter) === undefined)
  );
}

/** Whether some rows may be left out. */
export function isFiltered(view: RowView): boolean {
  return (
    view.search.trim() !== '' || view.filters.some((filter) => parseFilter(filter) !== undefined)
  );
}
