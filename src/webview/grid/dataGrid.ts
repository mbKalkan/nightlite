import type { CellValue, ObjectInfo, RowPage, ViewerStrings } from '../../shared/protocol';
import { icons } from '../icons';
import { cellText, escapeHtml, renderCell } from './cells';

export const ROW_HEIGHT = 22;
export const HEADER_HEIGHT = 26;
/** Rows are fetched in blocks of this many. */
export const BLOCK = 100;
const OVERSCAN = 8;
/** Browsers cap element heights; taller tables scroll through a scaled scrollbar. */
const MAX_SCROLL_HEIGHT = 8_000_000;
const MIN_WIDTH = 56;
const MAX_WIDTH = 360;
/** Blocks kept in memory; the ones farthest from the view go first. */
const KEEP_BLOCKS = 60;
/** The active cell's id, for `aria-activedescendant`; one grid is shown at a time. */
const ACTIVE_ID = 'nl-grid-active';

interface Block {
  rows: CellValue[][];
  types: string[];
  rowids?: string[];
}

export interface CellPosition {
  row: number;
  col: number;
}

/** A block of cells by row position and column index, both ends included. */
export interface CellRange {
  row1: number;
  col1: number;
  row2: number;
  col2: number;
}

export interface GridEvents {
  request(start: number, count: number, total: number): void;
  onTotal(total: number, exact: boolean): void;
  onSelection(): void;
  /** `toEnd`: the selection runs to the last row, wherever the count turns out to end. */
  onCopy(range: CellRange, toEnd: boolean): void;
}

/** What a mouse drag extends: cells, whole rows (from a row header) or whole columns. */
type Drag = 'cells' | 'rows' | 'columns';

/**
 * A virtualized table of rows: only the rows in view (plus a few) are in the DOM, fetched a
 * block at a time. Tables taller than a browser can scroll keep a logical position of their own
 * and map the scrollbar onto it, so the wheel and keys still move row by row while dragging
 * the scrollbar can reach any of millions of rows. Cells are selected like a spreadsheet's:
 * an active cell and a block around it, by mouse or keyboard.
 */
export class DataGrid {
  readonly element: HTMLElement;
  private readonly sizer: HTMLElement;
  private readonly header: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly blocks = new Map<number, Block>();
  private readonly pending = new Set<number>();
  private total: number;
  private exact = false;
  /** The scroll position in unscaled pixels: rows × ROW_HEIGHT. */
  private logicalTop = 0;
  private scale = 1;
  private frame = 0;
  private widthsMeasured = false;
  private widths: number[] = [];
  private rowHeaderWidth = 64;
  private failed = false;
  private context: CanvasRenderingContext2D | null | undefined;
  /** Where the selection started, and its other corner: the active cell. */
  private anchor: CellPosition = { row: 0, col: 0 };
  private focus: CellPosition = { row: 0, col: 0 };
  private drag: Drag | undefined;
  private readonly onCopy = (event: ClipboardEvent) => this.copy(event);
  private readonly onMouseUp = () => (this.drag = undefined);
  /**
   * VS Code runs Select All on the webview's text as well when Ctrl+A selects the cells;
   * the grid keeps that from highlighting the text around it.
   */
  private readonly onSelectStart = (event: Event) => {
    if (document.activeElement === this.element) event.preventDefault();
  };

  constructor(
    private readonly info: ObjectInfo,
    private readonly strings: ViewerStrings,
    private readonly locale: string,
    private readonly events: GridEvents,
  ) {
    this.total = info.estimate ?? BLOCK;
    this.element = document.createElement('div');
    this.element.className = 'nl-grid';
    this.element.tabIndex = 0;
    this.element.setAttribute('role', 'grid');
    this.element.setAttribute('aria-multiselectable', 'true');
    this.element.setAttribute('aria-colcount', String(info.columns.length + 1));
    this.element.setAttribute('aria-label', strings.rowsOf.replace('{0}', info.name));
    this.element.innerHTML = `
      <div class="nl-grid-sizer">
        <div class="nl-grid-header" role="row" aria-rowindex="1"></div>
        <div class="nl-grid-rows" role="rowgroup"></div>
      </div>`;
    this.sizer = this.element.querySelector('.nl-grid-sizer') as HTMLElement;
    this.header = this.element.querySelector('.nl-grid-header') as HTMLElement;
    this.layer = this.element.querySelector('.nl-grid-rows') as HTMLElement;

    this.setWidths(info.columns.map((column) => this.measureHeader(column)));
    this.renderHeader();
    this.element.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.element.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.element.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.element.addEventListener('mousedown', (event) => this.onMouseDown(event));
    this.element.addEventListener('mousemove', (event) => this.onMouseMove(event));
    window.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('copy', this.onCopy);
    document.addEventListener('selectstart', this.onSelectStart);
    new ResizeObserver(() => this.layout()).observe(this.element);
  }

  get rowCount(): { total: number; exact: boolean } {
    return { total: this.total, exact: this.exact };
  }

  get selection(): CellRange {
    return {
      row1: Math.min(this.anchor.row, this.focus.row),
      col1: Math.min(this.anchor.col, this.focus.col),
      row2: Math.max(this.anchor.row, this.focus.row),
      col2: Math.max(this.anchor.col, this.focus.col),
    };
  }

  get hasRowid(): boolean {
    return this.info.hasRowid;
  }

  columnName(col: number): string | undefined {
    return this.info.columns[col]?.name;
  }

  get activeCell(): CellPosition {
    return { ...this.focus };
  }

  /** A cell's value and storage class, when its rows have been read. */
  cell(row: number, col: number): { value: CellValue; type: string } | undefined {
    const block = this.blocks.get(Math.floor(row / BLOCK));
    const values = block?.rows[row % BLOCK];
    if (!block || !values) return undefined;
    return { value: values[col], type: block.types[row % BLOCK][col] };
  }

  /** What the row header says: the rowid, once read, or the row's number. */
  rowLabel(row: number): string | undefined {
    if (!this.info.hasRowid) return String(row + 1);
    return this.blocks.get(Math.floor(row / BLOCK))?.rowids?.[row % BLOCK];
  }

  /** The exact row count arrived from the background count. */
  setTotal(total: number, exact = true): void {
    const last = this.total - 1;
    this.total = Math.max(0, total);
    this.exact = exact;
    // Whole columns stay whole as the count changes.
    if (this.anchor.row === last) this.anchor.row = this.total - 1;
    if (this.focus.row === last) this.focus.row = this.total - 1;
    this.anchor = this.clamp(this.anchor);
    this.focus = this.clamp(this.focus);
    this.events.onTotal(this.total, this.exact);
    this.layout();
  }

  receive(page: RowPage): void {
    const block = Math.floor(page.start / BLOCK);
    this.pending.delete(block);
    this.blocks.set(block, { rows: page.rows, types: page.types, rowids: page.rowids });
    const reached = page.start + page.rows.length;
    if (page.end && (reached < this.total || !this.exact)) {
      this.setTotal(reached, true);
    } else if (!this.exact && this.info.estimate === null && reached >= this.total) {
      // No estimate: keep a block of room below the last rows read until the count arrives.
      this.total = reached + BLOCK;
      this.events.onTotal(this.total, false);
      this.layout();
    }
    if (!this.widthsMeasured && page.rows.length > 0) {
      this.widthsMeasured = true;
      this.fitWidths(page);
    }
    this.evict(block);
    this.schedule();
    // The active cell's value may have just arrived.
    this.events.onSelection();
  }

  /** Shows why rows couldn't be read, in place of the rows. */
  fail(title: string, detail: string): void {
    this.failed = true;
    this.layer.style.top = `${HEADER_HEIGHT}px`;
    this.layer.innerHTML = `<div class="nl-grid-message" role="alert"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('copy', this.onCopy);
    document.removeEventListener('selectstart', this.onSelectStart);
    this.element.remove();
  }

  /** Sizes the scrollable area for the row count and redraws. */
  layout(): void {
    const content = this.total * ROW_HEIGHT;
    const scrolled = Math.min(content, MAX_SCROLL_HEIGHT);
    this.sizer.style.height = `${HEADER_HEIGHT + scrolled}px`;
    this.element.setAttribute('aria-rowcount', String(this.total + 1));
    // Map the browser's scroll range exactly onto the rows', so the end of one is the end of
    // the other.
    const maxScroll = Math.max(0, HEADER_HEIGHT + scrolled - this.element.clientHeight);
    this.scale = content > MAX_SCROLL_HEIGHT && maxScroll > 0 ? this.maxLogical() / maxScroll : 1;
    this.logicalTop = Math.min(this.logicalTop, this.maxLogical());
    this.schedule();
  }

  /** How far the rows can scroll: all of them minus what fits in the view. */
  private maxLogical(): number {
    return Math.max(0, this.total * ROW_HEIGHT - this.viewHeight());
  }

  private viewHeight(): number {
    return Math.max(0, this.element.clientHeight - HEADER_HEIGHT);
  }

  private viewportRows(): number {
    return Math.max(1, Math.floor(this.viewHeight() / ROW_HEIGHT));
  }

  private schedule(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.render());
  }

  private onScroll(): void {
    if (this.scale === 1) {
      this.logicalTop = this.element.scrollTop;
    } else if (Math.abs(this.element.scrollTop * this.scale - this.logicalTop) > 2 * this.scale) {
      // The scrollbar was dragged: follow it. Closer than that is the browser rounding
      // the position we set.
      this.logicalTop = this.element.scrollTop * this.scale;
    }
    this.schedule();
  }

  private onWheel(event: WheelEvent): void {
    if (this.scale === 1 || event.ctrlKey) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? ROW_HEIGHT : event.deltaMode === 2 ? this.viewHeight() : 1;
    this.element.scrollLeft += event.deltaX * unit;
    this.scrollTo(this.logicalTop + event.deltaY * unit);
  }

  private onKeyDown(event: KeyboardEvent): void {
    const ctrl = event.ctrlKey || event.metaKey;
    const { row, col } = this.focus;
    const lastRow = this.total - 1;
    const lastCol = this.info.columns.length - 1;
    const page = Math.max(1, this.viewportRows() - 1);
    const move = (r: number, c: number) => this.select({ row: r, col: c }, event.shiftKey);
    switch (event.key) {
      case 'ArrowDown':
        move(ctrl ? lastRow : row + 1, col);
        break;
      case 'ArrowUp':
        move(ctrl ? 0 : row - 1, col);
        break;
      case 'ArrowRight':
        move(row, ctrl ? lastCol : col + 1);
        break;
      case 'ArrowLeft':
        move(row, ctrl ? 0 : col - 1);
        break;
      case 'PageDown':
        // The view moves a page too, so the active cell keeps its place on screen.
        this.scrollTo(this.logicalTop + page * ROW_HEIGHT);
        move(row + page, col);
        break;
      case 'PageUp':
        this.scrollTo(this.logicalTop - page * ROW_HEIGHT);
        move(row - page, col);
        break;
      case 'Home':
        move(ctrl ? 0 : row, 0);
        break;
      case 'End':
        move(ctrl ? lastRow : row, lastCol);
        break;
      case 'a':
      case 'A':
        if (!ctrl || event.shiftKey || event.altKey) return;
        this.selectAll();
        break;
      case 'Escape': {
        const { row1, col1, row2, col2 } = this.selection;
        if (row1 === row2 && col1 === col2) return;
        this.select(this.focus, false, false);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  }

  private onMouseDown(event: MouseEvent): void {
    if (event.button !== 0 || this.failed) return;
    const hit = this.hit(event);
    if (!hit) return;
    // Keep the browser from selecting text, and take focus the way a click would have.
    event.preventDefault();
    this.element.focus({ preventScroll: true });
    const lastRow = this.total - 1;
    const lastCol = this.info.columns.length - 1;
    const extend = event.shiftKey;
    if (hit.header && hit.col < 0) {
      this.selectAll();
    } else if (hit.header) {
      this.drag = 'columns';
      const from = extend ? this.anchor.col : hit.col;
      this.setSelection({ row: lastRow, col: from }, { row: 0, col: hit.col });
    } else if (hit.col < 0) {
      this.drag = 'rows';
      const from = extend ? this.anchor.row : hit.row;
      this.setSelection({ row: from, col: lastCol }, { row: hit.row, col: 0 });
    } else {
      this.drag = 'cells';
      this.select(hit, extend);
    }
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.drag) return;
    if ((event.buttons & 1) === 0) {
      this.drag = undefined;
      return;
    }
    const hit = this.hit(event);
    if (!hit) return;
    if (this.drag === 'columns' && hit.col >= 0) {
      this.setSelection(this.anchor, { row: 0, col: hit.col });
    } else if (this.drag === 'rows' && !hit.header) {
      this.setSelection(this.anchor, { row: hit.row, col: 0 });
    } else if (this.drag === 'cells' && !hit.header && hit.col >= 0) {
      this.setSelection(this.anchor, hit);
    }
  }

  /** The cell, row header or column header under the mouse; column -1 is the row headers. */
  private hit(event: MouseEvent): (CellPosition & { header: boolean }) | undefined {
    const target = (event.target as Element).closest<HTMLElement>('[data-col]');
    if (!target || !this.element.contains(target)) return undefined;
    const col = Number(target.dataset.col);
    const row = target.closest<HTMLElement>('[data-row]');
    if (row) return { row: Number(row.dataset.row), col, header: false };
    return { row: 0, col, header: true };
  }

  private selectAll(): void {
    this.setSelection(
      { row: this.total - 1, col: this.info.columns.length - 1 },
      { row: 0, col: 0 },
    );
  }

  /** Moves the active cell, starting a new selection or extending the one there is. */
  private select(target: CellPosition, extend: boolean, reveal = true): void {
    this.focus = this.clamp(target);
    if (!extend) this.anchor = { ...this.focus };
    if (reveal) this.reveal(this.focus);
    this.changed();
  }

  /** Selects a block without scrolling, as clicking a header does. */
  private setSelection(anchor: CellPosition, focus: CellPosition): void {
    this.anchor = this.clamp(anchor);
    this.focus = this.clamp(focus);
    this.changed();
  }

  private clamp({ row, col }: CellPosition): CellPosition {
    return {
      row: Math.max(0, Math.min(row, this.total - 1)),
      col: Math.max(0, Math.min(col, this.info.columns.length - 1)),
    };
  }

  private changed(): void {
    this.paintHeader();
    this.schedule();
    this.events.onSelection();
  }

  /** Scrolls just enough to show a cell whole, below the header and right of the row headers. */
  private reveal({ row, col }: CellPosition): void {
    const top = row * ROW_HEIGHT;
    const view = Math.max(ROW_HEIGHT, this.viewHeight());
    if (top < this.logicalTop) {
      this.scrollTo(top);
    } else if (top + ROW_HEIGHT > this.logicalTop + view) {
      this.scrollTo(top + ROW_HEIGHT - view);
    }
    const head = Math.round(this.rowHeaderWidth);
    let left = head;
    for (let c = 0; c < col; c++) left += this.widths[c] ?? 0;
    const right = left + (this.widths[col] ?? 0);
    const { scrollLeft, clientWidth } = this.element;
    if (left < scrollLeft + head) {
      this.element.scrollLeft = left - head;
    } else if (right > scrollLeft + clientWidth) {
      this.element.scrollLeft = Math.min(left - head, right - clientWidth);
    }
  }

  private copy(event: ClipboardEvent): void {
    // Text selected elsewhere, like in a message, copies as usual.
    if (document.activeElement !== this.element || this.failed) return;
    event.preventDefault();
    if (this.total === 0) return;
    const range = this.selection;
    this.events.onCopy(range, range.row2 >= this.total - 1 && !this.exact);
  }

  private scrollTo(top: number): void {
    this.logicalTop = Math.min(Math.max(0, top), this.maxLogical());
    this.element.scrollTop = this.logicalTop / this.scale;
    this.schedule();
  }

  private render(): void {
    if (this.failed) return;
    const first = Math.max(0, Math.floor(this.logicalTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(
      this.total - 1,
      Math.ceil(this.logicalTop / ROW_HEIGHT) + this.viewportRows() + OVERSCAN,
    );
    this.fetch(first, last);

    const scrollTop = this.element.scrollTop;
    this.layer.style.top = `${scrollTop + HEADER_HEIGHT + first * ROW_HEIGHT - this.logicalTop}px`;
    if (this.total === 0 && this.exact) {
      this.layer.innerHTML = `<div class="nl-grid-message">${escapeHtml(this.strings.noRows)}</div>`;
      this.element.removeAttribute('aria-activedescendant');
      return;
    }
    const selection = this.selection;
    let html = '';
    for (let position = first; position <= last; position++) {
      html += this.rowHtml(position, selection);
    }
    this.layer.innerHTML = html;
    if (this.layer.querySelector(`#${ACTIVE_ID}`)) {
      this.element.setAttribute('aria-activedescendant', ACTIVE_ID);
    } else {
      this.element.removeAttribute('aria-activedescendant');
    }
  }

  private rowHtml(position: number, selection: CellRange): string {
    const block = this.blocks.get(Math.floor(position / BLOCK));
    const index = position % BLOCK;
    const row = block?.rows[index];
    const selected = position >= selection.row1 && position <= selection.row2;
    const head = `nl-grid-cell nl-grid-rowhead${selected ? ' nl-grid-sel' : ''}`;
    const open = `<div class="nl-grid-row" role="row" aria-rowindex="${position + 2}" data-row="${position}">`;
    if (!block || !row) {
      return `${open.replace('nl-grid-row', 'nl-grid-row nl-grid-loading')}<div class="${head}" role="rowheader" data-col="-1"></div></div>`;
    }
    const label = block.rowids ? block.rowids[index] : String(position + 1);
    const types = block.types[index];
    let html = `${open}<div class="${head}" role="rowheader" data-col="-1">${escapeHtml(label)}</div>`;
    for (let c = 0; c < row.length; c++) {
      const cell = renderCell(row[c], types[c], this.locale);
      const inSelection = selected && c >= selection.col1 && c <= selection.col2;
      const active = position === this.focus.row && c === this.focus.col;
      let className = `nl-grid-cell ${cell.className}`;
      if (inSelection) className += ' nl-grid-sel';
      if (active) className += ' nl-grid-active';
      html +=
        `<div class="${className}" role="gridcell" aria-colindex="${c + 2}" data-col="${c}"` +
        (active ? ` id="${ACTIVE_ID}"` : '') +
        (inSelection ? ' aria-selected="true"' : '') +
        ` style="width:var(--w${c})">${cell.html}</div>`;
    }
    return `${html}</div>`;
  }

  private fetch(first: number, last: number): void {
    for (let block = Math.floor(first / BLOCK); block <= Math.floor(last / BLOCK); block++) {
      if (!this.blocks.has(block) && !this.pending.has(block)) {
        this.pending.add(block);
        this.events.request(block * BLOCK, BLOCK, this.total);
      }
    }
  }

  /** Keeps memory flat however far one scrolls. */
  private evict(near: number): void {
    if (this.blocks.size <= KEEP_BLOCKS) return;
    const farthest = [...this.blocks.keys()].sort(
      (a, b) => Math.abs(b - near) - Math.abs(a - near),
    );
    for (const block of farthest.slice(0, this.blocks.size - KEEP_BLOCKS)) {
      this.blocks.delete(block);
    }
  }

  private renderHeader(): void {
    const corner = this.info.hasRowid ? this.strings.rowid : '#';
    let html = `<div class="nl-grid-cell nl-grid-rowhead nl-grid-corner" role="columnheader" aria-colindex="1" data-col="-1">${escapeHtml(corner)}</div>`;
    this.info.columns.forEach((column, c) => {
      const traits = [column.type, column.primaryKey ? this.strings.primaryKey : '']
        .filter(Boolean)
        .join(' · ');
      const title = traits ? `${column.name} — ${traits}` : column.name;
      html +=
        `<div class="nl-grid-cell nl-grid-head" role="columnheader" aria-colindex="${c + 2}" data-col="${c}" style="width:var(--w${c})" title="${escapeHtml(title)}">` +
        `<span class="nl-grid-name">${escapeHtml(column.name)}</span>` +
        (column.primaryKey ? `<span class="nl-grid-key">${icons.index}</span>` : '') +
        (column.type ? `<span class="nl-grid-type">${escapeHtml(column.type)}</span>` : '') +
        '</div>';
    });
    this.header.innerHTML = html;
    this.paintHeader();
  }

  /** Marks the headers of the selected columns. */
  private paintHeader(): void {
    const { col1, col2 } = this.selection;
    this.header.querySelectorAll<HTMLElement>('.nl-grid-head').forEach((head, c) => {
      head.classList.toggle('nl-grid-sel', c >= col1 && c <= col2);
    });
  }

  /** Widens columns to fit the first rows, within limits, once they arrive. */
  private fitWidths(page: RowPage): void {
    const widths = this.info.columns.map((column, c) => {
      let width = this.measureHeader(column);
      for (let r = 0; r < Math.min(page.rows.length, 50); r++) {
        width = Math.max(
          width,
          this.measure(cellText(page.rows[r][c], page.types[r][c], this.locale)),
        );
      }
      return width;
    });
    // Room for the widest row label: the largest rowid read so far, or the row count.
    const label = page.rowids?.[page.rowids.length - 1] ?? String(this.total);
    const digits = Math.max(label.length, String(this.total).length);
    this.rowHeaderWidth = Math.max(48, this.measure('0'.repeat(digits)) + 20);
    this.setWidths(widths);
  }

  /** The header's name, key icon and declared type, with the gaps between them. */
  private measureHeader(column: ObjectInfo['columns'][number]): number {
    let width = this.measure(column.name, 600);
    if (column.primaryKey) width += 18;
    if (column.type) width += this.measure(column.type) * 0.85 + 6;
    return width;
  }

  private setWidths(widths: number[]): void {
    this.widths = widths.map((width) =>
      Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + 16))),
    );
    let total = Math.round(this.rowHeaderWidth);
    this.widths.forEach((width, c) => {
      this.element.style.setProperty(`--w${c}`, `${width}px`);
      total += width;
    });
    this.element.style.setProperty('--rowhead', `${Math.round(this.rowHeaderWidth)}px`);
    this.sizer.style.width = `${total}px`;
  }

  private measure(text: string, weight = 400): number {
    this.context ??= document.createElement('canvas').getContext('2d');
    if (!this.context) return text.length * 8;
    const style = getComputedStyle(document.body);
    const family = style.getPropertyValue('--vscode-editor-font-family') || 'monospace';
    const size = style.getPropertyValue('--vscode-editor-font-size') || '13px';
    this.context.font = `${weight} ${size} ${family}`;
    return this.context.measureText(text).width;
  }
}
