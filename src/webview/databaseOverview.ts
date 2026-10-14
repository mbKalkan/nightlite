import type { FileInfo, SchemaObject, TableSummary, ViewerStrings } from '../shared/protocol';
import { formatCount } from '../shared/units';
import { element, format, overviewView } from './views';

/** Tables beyond this many are left out of the overview; the sidebar lists them all. */
const MAX_TABLES = 500;

/** The tables' sizes as counted so far, kept while other pages are shown. */
export interface TablesState {
  /** Null for a table that couldn't be counted. */
  counts: Map<string, TableSummary | null>;
  counting: boolean;
}

/** The tables the overview lists and counts: the user's own, not SQLite's or a virtual table's. */
export function listedTables(objects: SchemaObject[]): string[] {
  return objects
    .filter((object) => object.type === 'table' && !object.internal)
    .map((object) => object.name)
    .slice(0, MAX_TABLES);
}

/**
 * A database's first view: the file's facts, how many of each kind of object it holds, and its
 * tables with their rows and columns, counted in the background and drawn to scale.
 */
export class DatabaseOverview {
  readonly element: HTMLElement;
  private readonly tables: HTMLElement;

  constructor(
    file: FileInfo,
    private readonly locale: string,
    private readonly strings: ViewerStrings,
    private readonly objects: SchemaObject[],
    private readonly state: TablesState,
    private readonly onOpen: (name: string) => void,
  ) {
    this.element = overviewView(file, locale, strings);
    this.tables = element('section', 'nl-section nl-table-sizes');
    this.element.append(this.contents(), this.tables);
    this.renderTables();
  }

  /** Redraws the tables, as each one's count arrives. */
  renderTables(): void {
    const { strings, state, locale } = this;
    const names = listedTables(this.objects);
    const parts: HTMLElement[] = [element('h2', 'nl-heading', strings.tables)];
    if (names.length === 0) {
      parts.push(element('p', 'nl-note', strings.noTables));
      this.tables.replaceChildren(...parts);
      return;
    }
    const most = Math.max(1, ...names.map((name) => state.counts.get(name)?.rows ?? 0));
    const table = element('div', 'nl-size-table');
    table.setAttribute('role', 'table');
    const head = element('div', 'nl-size-row nl-size-head');
    head.setAttribute('role', 'row');
    for (const label of [strings.nameColumn, strings.rowsColumn, strings.columnsHeading, '']) {
      const cell = element('span', '', label);
      cell.setAttribute('role', 'columnheader');
      head.append(cell);
    }
    table.append(head);
    for (const name of names) {
      const summary = state.counts.get(name);
      const row = element('div', `nl-size-row${summary === undefined ? ' nl-pending' : ''}`);
      row.setAttribute('role', 'row');
      const link = element('button', 'nl-link', name);
      link.setAttribute('type', 'button');
      link.addEventListener('click', () => this.onOpen(name));
      const bar = element('span', 'nl-size-bar');
      const fill = element('span', 'nl-size-fill');
      fill.style.width = `${summary?.rows ? Math.max(0.5, (summary.rows / most) * 100) : 0}%`;
      bar.append(fill);
      const pending = state.counting ? '…' : '—';
      // The link keeps its button role inside a cell of its own.
      const nameCell = element('span', 'nl-size-name');
      nameCell.append(link);
      const cells = [
        nameCell,
        element(
          'span',
          'nl-size-count',
          summary ? formatCount(summary.rows, locale) : summary === null ? '—' : pending,
        ),
        element('span', 'nl-size-count', summary ? formatCount(summary.columns, locale) : ''),
        bar,
      ];
      for (const cell of cells) cell.setAttribute('role', 'cell');
      row.append(...cells);
      table.append(row);
    }
    parts.push(table);
    const total = this.objects.filter((object) => object.type === 'table' && !object.internal);
    if (total.length > names.length) {
      parts.push(
        element(
          'p',
          'nl-note',
          format(strings.moreTables, formatCount(total.length - names.length, locale)),
        ),
      );
    }
    if (state.counting) {
      parts.push(element('p', 'nl-note', strings.countingRows));
    } else if (names.some((name) => state.counts.get(name) === null)) {
      parts.push(element('p', 'nl-note', strings.countRowsFailed));
    }
    this.tables.replaceChildren(...parts);
  }

  /** How many tables, views, indexes and triggers the database holds. */
  private contents(): HTMLElement {
    const { strings, locale } = this;
    const line = element('p', 'nl-contents');
    const groups: [string, SchemaObject['type']][] = [
      [strings.tables, 'table'],
      [strings.views, 'view'],
      [strings.indexes, 'index'],
      [strings.triggers, 'trigger'],
    ];
    for (const [label, type] of groups) {
      const count = this.objects.filter((object) => object.type === type).length;
      const part = element('span', 'nl-contents-part');
      // Label first, so it reads well in every language: "Tables 16".
      part.append(`${label} `, element('span', 'nl-contents-count', formatCount(count, locale)));
      line.append(part);
    }
    return line;
  }
}
