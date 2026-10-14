import type {
  CellValue,
  CopyResult,
  FullCell,
  HostToWebviewMessage,
  ObjectInfo,
  ViewerStrings,
  WebviewToHostMessage,
} from '../shared/protocol';
import { formatBytes, formatCount } from '../shared/units';
import { COPY_LIMIT, COPY_ROWS, realText } from '../shared/values';
import { CellDetail, type CellPlace } from './detail/cellDetail';
import { hexBytes } from './detail/format';
import { STORAGE_CLASSES, cellText } from './grid/cells';
import { DataGrid, type CellRange, type GridPosition } from './grid/dataGrid';
import { databaseErrorMessage, element, format } from './views';

export type DataMessage = Extract<
  HostToWebviewMessage,
  { type: 'objectInfo' | 'rowCount' | 'rowPage' | 'objectError' | 'copied' | 'cellValue' }
>;

export interface DataViewOptions {
  /** Whether the cell detail panel is open. */
  detail: boolean;
  /** The panel was opened or closed from inside the view. */
  onDetail(open: boolean): void;
  /** The panel's width as last resized, in pixels. */
  detailWidth?: number;
  /** Where the grid was when this table was last shown. */
  position?: GridPosition;
  onDetailWidth(width: number): void;
  /** A query's results, in place of a table's rows: the host holds them, all `total` of them. */
  results?: { query: number; info: ObjectInfo; total: number };
  /** What the grid says when there are no rows. */
  empty?: string;
}

/** The status bar shows this much of a value; the cell detail shows the rest. */
const PREVIEW = 200;
/** How long a copy's confirmation stays in the status bar. */
const NOTE_TIME = 4000;
/** A copy taking longer than this says it's under way. */
const SLOW_COPY = 250;
/** Values the panel asks the host for wait this long, so holding an arrow key asks once. */
const DETAIL_DELAY = 80;

let nextRequest = 1;

/**
 * A table's or view's rows: asks the extension host for the columns, then rows as the grid
 * scrolls, and shows the selection and the row and column counts below, and the selected
 * cell in full beside the grid when asked. Answers for another object, or for requests made
 * before this view, are ignored. A query's results show the same way.
 */
export class DataView {
  readonly element: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly selectionStatus: HTMLElement;
  private readonly note: HTMLElement;
  private readonly counts: HTMLElement;
  private readonly main: HTMLElement;
  private grid: DataGrid | undefined;
  private detail: CellDetail | undefined;
  private detailOpen: boolean;
  /** The cell the panel shows, so a repeated selection event doesn't ask again. */
  private detailKey = '';
  private detailPlace: CellPlace = { column: '', row: undefined };
  private detailRequest = 0;
  private detailTimer = 0;
  private readonly requests = new Set<number>();
  private readonly copies = new Set<number>();
  private columns = 0;
  private estimated = false;
  private noteTimer = 0;
  private copyTimer = 0;
  /** The query whose results these are; undefined for a table or view. */
  private readonly query: number | undefined;

  constructor(
    readonly name: string,
    private readonly strings: ViewerStrings,
    private readonly locale: string,
    private readonly send: (message: WebviewToHostMessage) => void,
    private readonly options: DataViewOptions,
  ) {
    this.detailOpen = options.detail;
    this.element = element('div', 'nl-data');
    this.main = element('div', 'nl-data-main');
    this.footer = element('div', 'nl-footer');
    this.selectionStatus = element('span', 'nl-status-selection');
    this.note = element('span', 'nl-status-note');
    this.note.setAttribute('aria-live', 'polite');
    this.counts = element('span', 'nl-status-counts');
    this.counts.setAttribute('aria-live', 'polite');
    this.footer.append(this.selectionStatus, this.note, this.counts);
    this.element.append(element('div', 'nl-progress'), this.footer);
    const results = options.results;
    this.query = results?.query;
    if (results) {
      this.start(results.info);
      this.grid?.setTotal(results.total, true);
    } else {
      send({ type: 'openObject', name });
    }
  }

  receive(message: DataMessage): void {
    if (
      message.type === 'objectInfo'
        ? message.info.name !== this.name || this.query !== undefined
        : message.name !== this.name ||
          ('query' in message ? message.query : undefined) !== this.query
    ) {
      return;
    }
    switch (message.type) {
      case 'objectInfo':
        this.start(message.info);
        break;
      case 'rowCount':
        this.grid?.setTotal(message.count, true);
        break;
      case 'rowPage':
        if (this.requests.delete(message.request)) {
          this.grid?.receive(message.page);
        }
        break;
      case 'cellValue':
        if (message.request === this.detailRequest) {
          this.detailRequest = 0;
          this.detail?.show(this.detailPlace, message.cell);
        }
        break;
      case 'copied':
        if (this.copies.delete(message.request)) {
          this.showNote(this.copiedText(message.result));
        }
        break;
      case 'objectError': {
        const text = databaseErrorMessage(message.error, this.strings);
        if (message.request !== undefined && this.copies.delete(message.request)) {
          this.showNote(format(this.strings.copyFailed, text));
          return;
        }
        if (message.request !== undefined && message.request === this.detailRequest) {
          this.detailRequest = 0;
          this.detail?.fail(
            this.detailPlace,
            this.strings.cellErrorTitle,
            `${text} ${message.detail}`,
          );
          return;
        }
        if (message.request !== undefined && !this.requests.delete(message.request)) return;
        if (this.grid) {
          this.grid.fail(this.strings.rowsErrorTitle, `${text} ${message.detail}`);
          this.detailKey = '';
          this.detail?.clear();
        } else {
          const box = element('div', 'nl-grid-message');
          box.setAttribute('role', 'alert');
          box.append(
            element('strong', '', this.strings.rowsErrorTitle),
            element('span', '', text),
            element('span', 'nl-error-detail', message.detail),
          );
          this.element.replaceChildren(box);
        }
        break;
      }
    }
  }

  focus(): void {
    this.grid?.element.focus();
  }

  /** The columns are known: the grid and the detail panel go in. */
  private start(info: ObjectInfo): void {
    if (this.grid) return;
    this.columns = info.columns.length;
    this.estimated = info.estimate !== null;
    this.grid = new DataGrid(
      info,
      this.strings,
      this.locale,
      {
        request: (start, count, total) => {
          const request = nextRequest++;
          this.requests.add(request);
          const { name, query } = this;
          this.send({ type: 'rows', request, name, query, start, count, total });
        },
        onTotal: (total, exact) => this.showCounts(total, exact),
        onSelection: () => {
          this.showSelection();
          this.updateDetail();
        },
        onCopy: (range, toEnd, markdown) => this.copy(range, toEnd, markdown),
        onEnter: () => this.setDetail(true, true),
      },
      this.options.empty,
    );
    this.detail = new CellDetail(
      this.strings,
      this.locale,
      {
        copy: () => {
          const cell = this.grid?.activeCell;
          if (cell)
            this.copy(
              { row1: cell.row, col1: cell.col, row2: cell.row, col2: cell.col },
              false,
              false,
            );
        },
        close: () => {
          this.setDetail(false);
          this.focus();
        },
        leave: () => this.focus(),
        resized: (width) => this.options.onDetailWidth(width),
      },
      this.options.detailWidth,
    );
    this.detail.element.hidden = !this.detailOpen;
    if (this.options.position) this.grid.restore(this.options.position);
    this.main.replaceChildren(this.grid.element, this.detail.element);
    this.element.replaceChildren(this.main, this.footer);
    this.showCounts(info.estimate ?? 0, false);
    this.showSelection();
    this.updateDetail();
  }

  /** Where the grid is, to come back to; undefined before the rows show. */
  position(): GridPosition | undefined {
    return this.grid?.position;
  }

  /** Opens or closes the cell detail panel; `focus` puts the keyboard in it. */
  setDetail(open: boolean, focus = false): void {
    if (open !== this.detailOpen) {
      this.detailOpen = open;
      this.options.onDetail(open);
    }
    if (!this.detail) return;
    this.detail.element.hidden = !open;
    this.detailKey = '';
    this.updateDetail();
    if (open && focus) this.detail.focus();
  }

  dispose(): void {
    clearTimeout(this.noteTimer);
    clearTimeout(this.copyTimer);
    clearTimeout(this.detailTimer);
    this.grid?.dispose();
    this.element.remove();
  }

  /** Copy or Copy as Markdown Table, from the context menu or the Command Palette. */
  copySelection(markdown: boolean): void {
    this.grid?.copySelection(markdown);
  }

  private copy(range: CellRange, toEnd: boolean, markdown: boolean): void {
    const request = nextRequest++;
    this.copies.add(request);
    clearTimeout(this.copyTimer);
    this.copyTimer = window.setTimeout(() => {
      clearTimeout(this.noteTimer);
      this.note.textContent = this.strings.copying;
    }, SLOW_COPY);
    this.send({
      type: 'copy',
      request,
      name: this.name,
      query: this.query,
      range: {
        start: range.row1,
        count: toEnd ? null : range.row2 - range.row1 + 1,
        total: this.grid?.rowCount.total ?? 0,
        firstColumn: range.col1,
        lastColumn: range.col2,
        markdown,
      },
    });
  }

  private copiedText(result: CopyResult): string {
    const limit = formatBytes(COPY_LIMIT, this.locale);
    if (result.stopped) {
      return format(
        this.strings.copiedStopped,
        formatCount(result.rows, this.locale),
        formatCount(COPY_ROWS, this.locale),
        limit,
      );
    }
    if (result.cut) return format(this.strings.copiedCut, limit);
    if (result.cells === 1) return this.strings.copiedValue;
    return result.rows === 1
      ? this.strings.copiedRow
      : format(this.strings.copiedRows, formatCount(result.rows, this.locale));
  }

  private showNote(text: string): void {
    clearTimeout(this.noteTimer);
    clearTimeout(this.copyTimer);
    this.note.textContent = text;
    this.noteTimer = window.setTimeout(() => (this.note.textContent = ''), NOTE_TIME);
  }

  /** One cell: where it is, its storage class and its value; a block: its size. */
  private showSelection(): void {
    const grid = this.grid;
    if (!grid || this.columns === 0 || grid.rowCount.total === 0) {
      this.selectionStatus.replaceChildren();
      return;
    }
    const { row1, col1, row2, col2 } = grid.selection;
    if (row1 !== row2 || col1 !== col2) {
      const rows = row2 - row1 + 1;
      const columns = col2 - col1 + 1;
      this.selectionStatus.replaceChildren(
        element('span', '', `${this.rowsText(rows)} × ${this.columnsText(columns)}`),
      );
      return;
    }
    const label = grid.rowLabel(row1);
    const column = grid.columnName(col1) ?? '';
    const where = label === undefined ? column : `${this.rowText(label)} · ${column}`;
    const parts = [element('span', 'nl-status-where', where)];
    const cell = grid.cell(row1, col1);
    if (cell) {
      parts.push(element('span', 'nl-status-type', STORAGE_CLASSES[cell.type] ?? ''));
      if (cell.type !== 'n') {
        const text = cellText(cell.value, cell.type, this.locale);
        const value = element(
          'span',
          'nl-status-value',
          text.length > PREVIEW ? `${text.slice(0, PREVIEW)}…` : text,
        );
        parts.push(value);
        const full = cell.value;
        if (full !== null && typeof full === 'object' && 'text' in full) {
          parts.push(
            element(
              'span',
              'nl-status-type',
              format(this.strings.characters, formatCount(full.length, this.locale)),
            ),
          );
        }
      }
    }
    this.selectionStatus.replaceChildren(...parts);
  }

  /**
   * Shows the active cell in the panel: at once when the grid holds all of it, else after
   * asking the host for the rest of long text or a BLOB's bytes.
   */
  private updateDetail(): void {
    const { grid, detail } = this;
    if (!grid || !detail || !this.detailOpen) return;
    if (grid.rowCount.total === 0 || this.columns === 0) {
      this.detailKey = '';
      detail.clear();
      return;
    }
    const { row, col } = grid.activeCell;
    const local = grid.cell(row, col);
    const key = `${row}:${col}:${local ? 'read' : 'waiting'}`;
    if (key === this.detailKey) return;
    this.detailKey = key;
    clearTimeout(this.detailTimer);
    this.detailRequest = 0;
    const label = grid.rowLabel(row);
    this.detailPlace = {
      column: grid.columnName(col) ?? '',
      row: label === undefined ? undefined : this.rowText(label),
    };
    const full = local && wholeCell(local.value, local.type);
    if (full) {
      detail.show(this.detailPlace, full);
      return;
    }
    detail.loading(this.detailPlace);
    // Rows still on their way come back through onSelection.
    if (!local) return;
    this.detailTimer = window.setTimeout(() => {
      const request = nextRequest++;
      this.detailRequest = request;
      this.send({
        type: 'cell',
        request,
        name: this.name,
        query: this.query,
        row,
        total: grid.rowCount.total,
        column: col,
        rowid: grid.hasRowid ? label : undefined,
      });
    }, DETAIL_DELAY);
  }

  private rowText(label: string): string {
    return this.grid?.hasRowid ? `${this.strings.rowid} ${label}` : `#${label}`;
  }

  private rowsText(rows: number): string {
    return rows === 1
      ? this.strings.oneRow
      : format(this.strings.rowCount, formatCount(rows, this.locale));
  }

  private columnsText(columns: number): string {
    return columns === 1
      ? this.strings.oneColumn
      : format(this.strings.columnCount, String(columns));
  }

  private showCounts(total: number, exact: boolean): void {
    const count = formatCount(total, this.locale);
    let rows: string;
    if (exact) {
      rows = this.rowsText(total);
    } else if (this.estimated && total > 0) {
      rows = `${format(this.strings.rowEstimate, count)} (${this.strings.counting})`;
    } else {
      rows = this.strings.counting;
    }
    this.counts.textContent = `${rows} · ${this.columnsText(this.columns)}`;
    this.showSelection();
  }
}

/** A cell as the panel shows it, when the grid already holds all of it. */
function wholeCell(value: CellValue, type: string): FullCell | undefined {
  switch (type) {
    case 'n':
      return { type, text: '', length: 0 };
    case 'i':
      return { type, text: String(value), length: String(value).length };
    case 'f': {
      const text = typeof value === 'number' ? realText(value) : String(value);
      return { type, text, length: text.length };
    }
    case 'b': {
      // Small BLOBs arrive whole: their first bytes are all of them.
      const blob = value as { size: number; head: string };
      return blob.head.length / 2 >= blob.size
        ? { type, text: blob.head, length: blob.size, bytes: hexBytes(blob.head) }
        : undefined;
    }
    default:
      return typeof value === 'string' ? { type, text: value, length: value.length } : undefined;
  }
}
