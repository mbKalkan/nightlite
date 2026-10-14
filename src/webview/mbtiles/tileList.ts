import type { TilePage, ViewerStrings } from '../../shared/protocol';
import { flipRow, sameTile, type RowScheme, type TileKey } from '../../shared/tiles';
import { escapeHtml } from '../grid/cells';

const ROW_HEIGHT = 22;
/** Tiles are fetched in blocks of this many. */
const BLOCK = 100;
const OVERSCAN = 8;
/** Browsers cap element heights; longer lists scroll through a scaled scrollbar. */
const MAX_SCROLL_HEIGHT = 8_000_000;
/** Blocks kept in memory; the ones farthest from the view go first. */
const KEEP_BLOCKS = 40;
const ACTIVE_ID = 'nl-tile-active';

export interface TileListEvents {
  request(start: number, count: number): void;
  /** The user picked the tile at a position, by mouse or keyboard. */
  onPick(key: TileKey, position: number): void;
}

/**
 * One zoom level's tiles as a list box, in the order the tiles index keeps them: by column, then
 * row. Like the data grid it keeps only the rows in view, fetched a block at a time, and maps a
 * scaled scrollbar onto lists too long for the browser, as at zoom 14 of a planet.
 */
export class TileList {
  readonly element: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly sizer: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly blocks = new Map<number, [number, number][]>();
  private readonly pending = new Set<number>();
  private logicalTop = 0;
  private scale = 1;
  private frame = 0;
  /** The list's own place: where the selected tile is, or would be. */
  private active = -1;
  private selected: TileKey | undefined;
  /** A position picked by keyboard before its tiles arrived. */
  private wanted: number | undefined;
  /** The total, once rows past where a tile was estimated to be ran out. */
  private end: number;

  constructor(
    readonly zoom: number,
    private readonly total: number,
    private scheme: RowScheme,
    strings: ViewerStrings,
    private readonly events: TileListEvents,
  ) {
    this.end = total;
    this.element = document.createElement('div');
    this.element.className = 'nl-tile-list';
    this.element.innerHTML = `
      <div class="nl-tile-list-head" aria-hidden="true"><span>x</span><span>y</span></div>
      <div class="nl-tile-list-scroll" role="listbox" tabindex="0">
        <div class="nl-tile-list-sizer"><div class="nl-tile-list-rows"></div></div>
      </div>`;
    this.scroller = this.element.querySelector('.nl-tile-list-scroll') as HTMLElement;
    this.sizer = this.element.querySelector('.nl-tile-list-sizer') as HTMLElement;
    this.layer = this.element.querySelector('.nl-tile-list-rows') as HTMLElement;
    this.scroller.setAttribute('aria-label', strings.tilesAtZoomList.replace('{0}', String(zoom)));
    this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.scroller.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.scroller.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.scroller.addEventListener('mousedown', (event) => this.onMouseDown(event));
    new ResizeObserver(() => this.layout()).observe(this.scroller);
  }

  /** Marks a tile as the one shown, and puts it in view when its position is known. */
  select(key: TileKey | undefined, position?: number): void {
    this.selected = key;
    if (position !== undefined) {
      this.active = Math.min(position, this.total - 1);
      this.reveal(this.active);
    } else {
      const found = key && this.find(key);
      if (found !== undefined) this.active = found;
    }
    this.schedule();
  }

  /** Whether the list holds the tile, among the rows it has read. */
  has(key: TileKey): boolean {
    return this.find(key) !== undefined;
  }

  setScheme(scheme: RowScheme): void {
    this.scheme = scheme;
    this.schedule();
  }

  focus(): void {
    this.scroller.focus({ preventScroll: true });
  }

  receive(page: TilePage): void {
    const block = Math.floor(page.start / BLOCK);
    this.pending.delete(block);
    if (page.start % BLOCK !== 0) {
      // A page read back from a later tile can start short of its block when estimates ran
      // ahead of the tiles; spread it over the blocks it covers.
      page.tiles.forEach((tile, i) => this.put(page.start + i, tile));
    } else {
      this.blocks.set(block, page.tiles);
    }
    if (page.end) {
      this.end = Math.min(this.end, page.start + page.tiles.length);
    }
    this.evict(block);
    if (this.wanted !== undefined) {
      const tile = this.tileAt(this.wanted);
      if (tile) {
        const position = this.wanted;
        this.wanted = undefined;
        this.pick(position, tile);
      }
    }
    if (this.selected && this.active < 0) {
      const found = this.find(this.selected);
      if (found !== undefined) this.active = found;
    }
    this.schedule();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.element.remove();
  }

  private put(position: number, tile: [number, number]): void {
    const block = Math.floor(position / BLOCK);
    const rows = this.blocks.get(block) ?? [];
    rows[position % BLOCK] = tile;
    this.blocks.set(block, rows);
  }

  private tileAt(position: number): [number, number] | undefined {
    return this.blocks.get(Math.floor(position / BLOCK))?.[position % BLOCK];
  }

  private find(key: TileKey): number | undefined {
    if (key.zoom !== this.zoom) return undefined;
    for (const [block, rows] of this.blocks) {
      const index = rows.findIndex((tile) => tile && tile[0] === key.column && tile[1] === key.row);
      if (index >= 0) return block * BLOCK + index;
    }
    return undefined;
  }

  private layout(): void {
    const content = this.total * ROW_HEIGHT;
    const scrolled = Math.min(content, MAX_SCROLL_HEIGHT);
    this.sizer.style.height = `${scrolled}px`;
    const maxScroll = Math.max(0, scrolled - this.scroller.clientHeight);
    this.scale = content > MAX_SCROLL_HEIGHT && maxScroll > 0 ? this.maxLogical() / maxScroll : 1;
    this.logicalTop = Math.min(this.logicalTop, this.maxLogical());
    if (this.active >= 0 && this.scroller.clientHeight > 0) this.reveal(this.active);
    this.schedule();
  }

  private maxLogical(): number {
    return Math.max(0, this.total * ROW_HEIGHT - this.scroller.clientHeight);
  }

  private viewportRows(): number {
    return Math.max(1, Math.floor(this.scroller.clientHeight / ROW_HEIGHT));
  }

  private schedule(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.render());
  }

  private onScroll(): void {
    if (this.scale === 1) {
      this.logicalTop = this.scroller.scrollTop;
    } else if (Math.abs(this.scroller.scrollTop * this.scale - this.logicalTop) > 2 * this.scale) {
      this.logicalTop = this.scroller.scrollTop * this.scale;
    }
    this.schedule();
  }

  private onWheel(event: WheelEvent): void {
    if (this.scale === 1 || event.ctrlKey) return;
    event.preventDefault();
    const unit =
      event.deltaMode === 1 ? ROW_HEIGHT : event.deltaMode === 2 ? this.scroller.clientHeight : 1;
    this.scrollTo(this.logicalTop + event.deltaY * unit);
  }

  private onKeyDown(event: KeyboardEvent): void {
    const page = Math.max(1, this.viewportRows() - 1);
    const from = Math.max(0, this.active);
    let target: number;
    switch (event.key) {
      case 'ArrowDown':
        target = this.active < 0 ? 0 : from + 1;
        break;
      case 'ArrowUp':
        target = from - 1;
        break;
      case 'PageDown':
        target = from + page;
        break;
      case 'PageUp':
        target = from - page;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = this.end - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    target = Math.max(0, Math.min(this.end - 1, target));
    this.active = target;
    this.reveal(target);
    const tile = this.tileAt(target);
    if (tile) {
      this.pick(target, tile);
    } else {
      this.wanted = target;
    }
    this.schedule();
  }

  private onMouseDown(event: MouseEvent): void {
    const row = (event.target as Element).closest<HTMLElement>('[data-position]');
    // A right click picks the tile too, for the context menu's Copy Reference.
    if ((event.button !== 0 && event.button !== 2) || !row) return;
    event.preventDefault();
    this.scroller.focus({ preventScroll: true });
    const position = Number(row.dataset.position);
    const tile = this.tileAt(position);
    if (tile) {
      this.active = position;
      this.pick(position, tile);
    }
  }

  private pick(position: number, [column, row]: [number, number]): void {
    const key = { zoom: this.zoom, column, row };
    if (sameTile(key, this.selected)) return;
    this.selected = key;
    this.events.onPick(key, position);
    this.schedule();
  }

  private reveal(position: number): void {
    const top = position * ROW_HEIGHT;
    const view = Math.max(ROW_HEIGHT, this.scroller.clientHeight);
    if (top >= this.logicalTop && top + ROW_HEIGHT <= this.logicalTop + view) return;
    if (top < this.logicalTop - view || top > this.logicalTop + 2 * view) {
      // A tile far away goes to the middle, with its neighbors around it.
      this.scrollTo(top - (view - ROW_HEIGHT) / 2);
    } else if (top < this.logicalTop) {
      this.scrollTo(top);
    } else {
      this.scrollTo(top + ROW_HEIGHT - view);
    }
  }

  private scrollTo(top: number): void {
    this.logicalTop = Math.min(Math.max(0, top), this.maxLogical());
    this.scroller.scrollTop = this.logicalTop / this.scale;
    this.schedule();
  }

  private render(): void {
    const first = Math.max(0, Math.floor(this.logicalTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(
      this.total - 1,
      Math.ceil(this.logicalTop / ROW_HEIGHT) + this.viewportRows() + OVERSCAN,
    );
    this.fetch(first, Math.min(last, this.end - 1));
    this.layer.style.top = `${this.scroller.scrollTop + first * ROW_HEIGHT - this.logicalTop}px`;
    let html = '';
    for (let position = first; position <= last; position++) {
      html += this.rowHtml(position);
    }
    this.layer.innerHTML = html;
    if (this.layer.querySelector(`#${ACTIVE_ID}`)) {
      this.scroller.setAttribute('aria-activedescendant', ACTIVE_ID);
    } else {
      this.scroller.removeAttribute('aria-activedescendant');
    }
  }

  private rowHtml(position: number): string {
    const block = this.blocks.get(Math.floor(position / BLOCK));
    const tile = block?.[position % BLOCK];
    if (!tile) {
      // Past the end, or a gap estimates left in a block that arrived: nothing to fetch.
      const none = position >= this.end || block !== undefined;
      return none
        ? '<div class="nl-tile-row"></div>'
        : `<div class="nl-tile-row nl-tile-row-loading" data-position="${position}"></div>`;
    }
    const [column, row] = tile;
    const selected =
      this.selected?.zoom === this.zoom &&
      this.selected.column === column &&
      this.selected.row === row;
    const shown = this.scheme === 'tms' ? row : flipRow(this.zoom, row);
    const active = position === this.active;
    return (
      `<div class="nl-tile-row${selected ? ' nl-tile-row-selected' : ''}${active ? ' nl-tile-row-active' : ''}" role="option"` +
      ` aria-selected="${selected}" aria-setsize="${this.total}" aria-posinset="${position + 1}"` +
      (active ? ` id="${ACTIVE_ID}"` : '') +
      ` data-position="${position}"><span>${escapeHtml(String(column))}</span><span>${escapeHtml(String(shown))}</span></div>`
    );
  }

  private fetch(first: number, last: number): void {
    for (let block = Math.floor(first / BLOCK); block <= Math.floor(last / BLOCK); block++) {
      if (!this.blocks.has(block) && !this.pending.has(block)) {
        this.pending.add(block);
        this.events.request(block * BLOCK, BLOCK);
      }
    }
  }

  private evict(near: number): void {
    if (this.blocks.size <= KEEP_BLOCKS) return;
    const farthest = [...this.blocks.keys()].sort(
      (a, b) => Math.abs(b - near) - Math.abs(a - near),
    );
    for (const block of farthest.slice(0, this.blocks.size - KEEP_BLOCKS)) {
      this.blocks.delete(block);
    }
  }
}
