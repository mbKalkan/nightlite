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

interface Block {
  rows: CellValue[][];
  types: string[];
  rowids?: string[];
}

/**
 * A virtualized table of rows: only the rows in view (plus a few) are in the DOM, fetched a
 * block at a time. Tables taller than a browser can scroll keep a logical position of their own
 * and map the scrollbar onto it, so the wheel and keys still move row by row while dragging
 * the scrollbar can reach any of millions of rows.
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
  private rowHeaderWidth = 64;
  private failed = false;
  private context: CanvasRenderingContext2D | null | undefined;

  constructor(
    private readonly info: ObjectInfo,
    private readonly strings: ViewerStrings,
    private readonly locale: string,
    private readonly request: (start: number, count: number, total: number) => void,
    private readonly onTotal: (total: number, exact: boolean) => void,
  ) {
    this.total = info.estimate ?? BLOCK;
    this.element = document.createElement('div');
    this.element.className = 'nl-grid';
    this.element.tabIndex = 0;
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-label', strings.rowsOf.replace('{0}', info.name));
    this.element.innerHTML = `
      <div class="nl-grid-sizer">
        <div class="nl-grid-header"></div>
        <div class="nl-grid-rows"></div>
      </div>`;
    this.sizer = this.element.querySelector('.nl-grid-sizer') as HTMLElement;
    this.header = this.element.querySelector('.nl-grid-header') as HTMLElement;
    this.layer = this.element.querySelector('.nl-grid-rows') as HTMLElement;

    this.setWidths(info.columns.map((column) => this.measureHeader(column)));
    this.renderHeader();
    this.element.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.element.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.element.addEventListener('keydown', (event) => this.onKeyDown(event));
    new ResizeObserver(() => this.layout()).observe(this.element);
  }

  get rowCount(): { total: number; exact: boolean } {
    return { total: this.total, exact: this.exact };
  }

  /** The exact row count arrived from the background count. */
  setTotal(total: number, exact = true): void {
    this.total = Math.max(0, total);
    this.exact = exact;
    this.onTotal(this.total, this.exact);
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
      this.onTotal(this.total, false);
      this.layout();
    }
    if (!this.widthsMeasured && page.rows.length > 0) {
      this.widthsMeasured = true;
      this.fitWidths(page);
    }
    this.evict(block);
    this.schedule();
  }

  /** Shows why rows couldn't be read, in place of the rows. */
  fail(title: string, detail: string): void {
    this.failed = true;
    this.layer.style.top = `${HEADER_HEIGHT}px`;
    this.layer.innerHTML = `<div class="nl-grid-message" role="alert"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.element.remove();
  }

  /** Sizes the scrollable area for the row count and redraws. */
  layout(): void {
    const content = this.total * ROW_HEIGHT;
    const scrolled = Math.min(content, MAX_SCROLL_HEIGHT);
    this.sizer.style.height = `${HEADER_HEIGHT + scrolled}px`;
    // Map the browser's scroll range exactly onto the rows', so the end of one is the end of
    // the other.
    const maxScroll = Math.max(0, HEADER_HEIGHT + scrolled - this.element.clientHeight);
    this.scale = content > MAX_SCROLL_HEIGHT && maxScroll > 0 ? this.maxLogical() / maxScroll : 1;
    this.logicalTop = Math.min(this.logicalTop, this.maxLogical());
    this.schedule();
  }

  /** How far the rows can scroll: all of them minus what fits in the view. */
  private maxLogical(): number {
    const view = Math.max(0, this.element.clientHeight - HEADER_HEIGHT);
    return Math.max(0, this.total * ROW_HEIGHT - view);
  }

  private viewportRows(): number {
    return Math.max(1, Math.floor((this.element.clientHeight - HEADER_HEIGHT) / ROW_HEIGHT));
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
    const unit = event.deltaMode === 1 ? ROW_HEIGHT : event.deltaMode === 2 ? this.page() : 1;
    this.element.scrollLeft += event.deltaX * unit;
    this.scrollTo(this.logicalTop + event.deltaY * unit);
  }

  private onKeyDown(event: KeyboardEvent): void {
    const page = this.page();
    const moves: Record<string, number | undefined> = {
      ArrowDown: ROW_HEIGHT,
      ArrowUp: -ROW_HEIGHT,
      PageDown: page,
      PageUp: -page,
    };
    if (event.key in moves) {
      this.scrollTo(this.logicalTop + (moves[event.key] as number));
    } else if (event.key === 'Home') {
      this.scrollTo(0);
    } else if (event.key === 'End') {
      this.scrollTo(Infinity);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      this.element.scrollLeft += event.key === 'ArrowRight' ? 40 : -40;
    } else {
      return;
    }
    event.preventDefault();
  }

  private page(): number {
    return Math.max(ROW_HEIGHT, (this.viewportRows() - 1) * ROW_HEIGHT);
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
      return;
    }
    let html = '';
    for (let position = first; position <= last; position++) {
      html += this.rowHtml(position);
    }
    this.layer.innerHTML = html;
  }

  private rowHtml(position: number): string {
    const block = this.blocks.get(Math.floor(position / BLOCK));
    const index = position % BLOCK;
    const row = block?.rows[index];
    if (!block || !row) {
      return `<div class="nl-grid-row nl-grid-loading"><div class="nl-grid-cell nl-grid-rowhead"></div></div>`;
    }
    const label = block.rowids ? block.rowids[index] : String(position + 1);
    const types = block.types[index];
    let html = `<div class="nl-grid-row"><div class="nl-grid-cell nl-grid-rowhead">${escapeHtml(label)}</div>`;
    for (let c = 0; c < row.length; c++) {
      const cell = renderCell(row[c], types[c], this.locale);
      html += `<div class="nl-grid-cell ${cell.className}" style="width:var(--w${c})">${cell.html}</div>`;
    }
    return `${html}</div>`;
  }

  private fetch(first: number, last: number): void {
    for (let block = Math.floor(first / BLOCK); block <= Math.floor(last / BLOCK); block++) {
      if (!this.blocks.has(block) && !this.pending.has(block)) {
        this.pending.add(block);
        this.request(block * BLOCK, BLOCK, this.total);
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
    let html = `<div class="nl-grid-cell nl-grid-rowhead nl-grid-corner">${escapeHtml(corner)}</div>`;
    this.info.columns.forEach((column, c) => {
      const traits = [column.type, column.primaryKey ? this.strings.primaryKey : '']
        .filter(Boolean)
        .join(' · ');
      const title = traits ? `${column.name} — ${traits}` : column.name;
      html +=
        `<div class="nl-grid-cell nl-grid-head" style="width:var(--w${c})" title="${escapeHtml(title)}">` +
        `<span class="nl-grid-name">${escapeHtml(column.name)}</span>` +
        (column.primaryKey ? `<span class="nl-grid-key">${icons.index}</span>` : '') +
        (column.type ? `<span class="nl-grid-type">${escapeHtml(column.type)}</span>` : '') +
        '</div>';
    });
    this.header.innerHTML = html;
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
    let total = this.rowHeaderWidth;
    widths.forEach((width, c) => {
      const clamped = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + 16)));
      this.element.style.setProperty(`--w${c}`, `${clamped}px`);
      total += clamped;
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
