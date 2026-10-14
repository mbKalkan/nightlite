import type { ObjectType, ViewerStrings } from '../shared/protocol';
import { inlineSql, sqlName } from '../shared/reference';
import { isFiltered, isPlain, type RowView } from '../shared/rowFilter';
import { format } from './views';

let last: Element | undefined;

/**
 * Remembers right-clicks inside `root`: VS Code's context menu tells the webview only the
 * command chosen. A click or a key after one means its menu was left, and a command from the
 * Command Palette then means what's in view.
 */
export function trackContextMenu(root: HTMLElement): void {
  root.addEventListener('contextmenu', (event) => {
    last = event.target instanceof Element ? event.target : undefined;
  });
  root.addEventListener('mousedown', (event) => {
    if (event.button === 0) last = undefined;
  });
  root.addEventListener('keydown', () => (last = undefined));
}

/** The element last right-clicked, as long as it's still on screen; once. */
export function takeContextTarget(): Element | undefined {
  const target = last?.isConnected ? last : undefined;
  last = undefined;
  return target;
}

/** Whose rows a grid shows: a table's or view's, or a query's results. */
export type RowSource = { type: 'table' | 'view'; name: string } | { type: 'query'; sql: string };

/** Where a grid's selection is, as `gridLocation` names it. */
export interface GridPlace {
  source: RowSource;
  /** The selected block, by row position and column index, both ends included. */
  selection: { row1: number; col1: number; row2: number; col2: number };
  /** How many rows the grid shows. */
  total: number;
  columns: readonly string[];
  /** How the rows are sorted and filtered; a query's results are in the query's own order. */
  view: RowView;
  /** A row's rowid, when the table has them and the grid has read the row. */
  rowid?(row: number): string | undefined;
}

/** Rows not in rowid order are named by their rowids up to this many, else by position. */
const LISTED_ROWIDS = 100;

/**
 * A grid selection's place, the way someone reading it could find it again: the table, the rows
 * by rowid when it has them, else by position and how the rows were sorted and filtered, and the
 * columns. All of the rows or all of the columns go without saying.
 */
export function gridLocation(place: GridPlace, strings: ViewerStrings): string {
  const { selection, columns, view, total } = place;
  const parts = [sourceLocation(place.source, strings)];
  if (total === 0 || columns.length === 0) return parts[0];
  const allRows = selection.row1 === 0 && selection.row2 >= total - 1 && total > 1;
  const byRowid = allRows ? undefined : rowidPart(place, strings);
  if (byRowid) {
    parts.push(byRowid);
  } else {
    if (!allRows) {
      parts.push(
        selection.row1 === selection.row2
          ? format(strings.refRow, String(selection.row1 + 1))
          : format(strings.refRows, String(selection.row1 + 1), String(selection.row2 + 1)),
      );
    }
    // Positions among rows sorted or filtered mean something only with how they were.
    if (view.order) {
      parts.push(
        format(
          view.order.descending ? strings.refSortedDescending : strings.refSorted,
          sqlName(columns[view.order.column] ?? ''),
        ),
      );
    }
    if (isFiltered(view)) parts.push(strings.refFiltered);
  }
  const allColumns = selection.col1 === 0 && selection.col2 >= columns.length - 1;
  if (!allColumns || columns.length === 1) {
    const first = sqlName(columns[selection.col1] ?? '');
    parts.push(
      selection.col1 === selection.col2
        ? format(strings.refColumn, first)
        : format(strings.refColumns, first, sqlName(columns[selection.col2] ?? '')),
    );
  }
  return parts.join(', ');
}

/** The selected rows by rowid: one, a range in rowid order, or a short list sorted otherwise. */
function rowidPart(place: GridPlace, strings: ViewerStrings): string | undefined {
  const { rowid } = place;
  if (!rowid) return undefined;
  const { row1, row2 } = place.selection;
  if (row1 === row2) {
    const id = rowid(row1);
    return id === undefined ? undefined : format(strings.refRowid, id);
  }
  if (isPlain(place.view)) {
    const first = rowid(row1);
    const last = rowid(row2);
    return first === undefined || last === undefined
      ? undefined
      : format(strings.refRowidRange, first, last);
  }
  if (row2 - row1 + 1 > LISTED_ROWIDS) return undefined;
  const ids: string[] = [];
  for (let row = row1; row <= row2; row++) {
    const id = rowid(row);
    if (id === undefined) return undefined;
    ids.push(id);
  }
  return format(strings.refRowids, ids.join(', '));
}

/** A table, view, index or trigger; or a query, by its statement on one line. */
export function sourceLocation(
  source: RowSource | { type: ObjectType; name: string },
  strings: ViewerStrings,
): string {
  switch (source.type) {
    case 'table':
      return format(strings.refTable, sqlName(source.name));
    case 'view':
      return format(strings.refView, sqlName(source.name));
    case 'index':
      return format(strings.refIndex, sqlName(source.name));
    case 'trigger':
      return format(strings.refTrigger, sqlName(source.name));
    case 'query':
      return format(strings.refQuery, inlineSql(source.sql));
  }
}
