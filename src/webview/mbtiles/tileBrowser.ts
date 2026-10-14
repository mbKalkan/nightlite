import { RASTER_FORMATS, readTileset, zoomLevels, type Tileset } from '../../shared/mbtiles';
import type {
  HostToWebviewMessage,
  ViewerStrings,
  WebviewToHostMessage,
} from '../../shared/protocol';
import {
  parseTileAddress,
  sameTile,
  stepTile,
  tileAddress,
  tileAt,
  type RowScheme,
  type TileKey,
  type TileStep,
} from '../../shared/tiles';
import { formatCount } from '../../shared/units';
import { databaseErrorMessage, element, format } from '../views';
import type { TilesState } from './summary';
import { TileList } from './tileList';
import { TilePreview } from './tilePreview';

/** What the tile browser remembers while other pages are shown, and across reloads. */
export interface TileView {
  /** The tile shown. */
  tile?: TileKey;
  /** The zoom level to start at, before a tile is shown. */
  zoom?: number;
  scheme: RowScheme;
  /** Layers hidden by name, so they stay hidden from tile to tile. */
  hidden: Set<string>;
}

export type TileMessage = Extract<
  HostToWebviewMessage,
  { type: 'tilePage' | 'tilePosition' | 'tileContent' | 'tilesError' }
>;

export interface TileBrowserEvents {
  send(message: WebviewToHostMessage): void;
  /** The tile, zoom, numbering or hidden layers changed: worth remembering. */
  onView(view: TileView): void;
}

/**
 * Browses an MBTiles file's tiles: a zoom level's tiles as a list, and the selected tile drawn
 * beside it. Arrow keys move to neighboring tiles and + and − between zoom levels; the address
 * box takes a tile's z/x/y or a tile URL.
 */
export class TileBrowser {
  readonly element: HTMLElement;
  private readonly zoomSelect: HTMLSelectElement;
  private readonly addressInput: HTMLInputElement;
  private readonly addressNote: HTMLElement;
  private readonly schemeButtons: HTMLButtonElement[];
  private readonly main: HTMLElement;
  private readonly listPlace: HTMLElement;
  private readonly preview: TilePreview;
  private tileset: Tileset | undefined;
  private list: TileList | undefined;
  private listKey = '';
  private started = false;
  private nextRequest = 1;
  /** The latest requests for the shown tile and for its place in the list. */
  private contentRequest = 0;
  private locateRequest = 0;
  /** A tile asked for on the way somewhere: if there's none, the zoom level's first is shown. */
  private fallbackRequest = 0;
  private firstRequest = 0;
  /** List pages are asked for from this request on; older answers are for an older list. */
  private listFrom = Infinity;

  constructor(
    private readonly locale: string,
    private readonly strings: ViewerStrings,
    private readonly state: TilesState,
    private readonly view: TileView,
    private readonly events: TileBrowserEvents,
  ) {
    this.element = element('div', 'nl-tiles');
    const bar = element('div', 'nl-tiles-bar');
    const zoomLabel = element('label', 'nl-tiles-label', strings.zoomColumn) as HTMLLabelElement;
    this.zoomSelect = document.createElement('select');
    this.zoomSelect.className = 'nl-select';
    this.zoomSelect.id = 'nl-zoom';
    zoomLabel.htmlFor = 'nl-zoom';
    this.zoomSelect.addEventListener('change', () => this.pickZoom(Number(this.zoomSelect.value)));

    this.addressInput = document.createElement('input');
    this.addressInput.className = 'nl-input nl-address';
    this.addressInput.spellcheck = false;
    this.addressInput.placeholder = strings.tileAddressHint;
    this.addressInput.title = strings.tileAddressHint;
    this.addressInput.setAttribute('aria-label', strings.goToTile);
    this.addressInput.setAttribute('aria-describedby', 'nl-address-note');
    this.addressInput.addEventListener('keydown', (event) => this.onAddressKey(event));
    this.addressInput.addEventListener('input', () => this.markAddress(true));
    this.addressNote = element('span', 'nl-address-note');
    this.addressNote.id = 'nl-address-note';
    this.addressNote.setAttribute('role', 'status');
    const address = element('div', 'nl-address-box');
    address.append(this.addressInput, this.addressNote);

    const schemes = element('div', 'nl-segmented');
    schemes.setAttribute('role', 'radiogroup');
    schemes.setAttribute('aria-label', strings.rowScheme);
    this.schemeButtons = (['xyz', 'tms'] as const).map((scheme) => {
      const button = element('button', 'nl-segment', scheme.toUpperCase()) as HTMLButtonElement;
      button.type = 'button';
      button.dataset.scheme = scheme;
      button.setAttribute('role', 'radio');
      button.title = scheme === 'xyz' ? strings.xyzHint : strings.tmsHint;
      button.addEventListener('click', () => this.setScheme(scheme));
      return button;
    });
    schemes.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      this.setScheme(this.view.scheme === 'xyz' ? 'tms' : 'xyz');
      this.schemeButtons.find((button) => button.dataset.scheme === this.view.scheme)?.focus();
    });
    schemes.append(...this.schemeButtons);
    bar.append(zoomLabel, this.zoomSelect, address, schemes);

    this.main = element('div', 'nl-tiles-main');
    this.listPlace = element('div', 'nl-tile-list-place');
    this.preview = new TilePreview(strings, locale, view.scheme, view.hidden, {
      onStep: (step) => this.step(step),
      onSave: () => this.save(),
      onLayers: () => this.events.onView(this.view),
    });
    this.main.append(this.listPlace, this.preview.element);
    this.element.append(bar, this.main);
    this.markScheme();
    this.update();
  }

  /** The tileset's metadata, zoom range or a zoom level's count arrived. */
  update(): void {
    const { state, strings } = this;
    if (state.error) {
      this.replaceMain(
        this.message(
          strings.mbtilesErrorTitle,
          databaseErrorMessage(state.error.error, strings),
          state.error.detail,
        ),
      );
      return;
    }
    const ready = state.summary !== undefined && state.range !== undefined;
    this.zoomSelect.disabled = !ready;
    this.addressInput.disabled = !ready;
    if (!state.summary || state.range === undefined) {
      if (state.failed) {
        this.replaceMain(this.message(strings.countFailed));
      } else if (!this.main.querySelector(':scope > .nl-progress')) {
        this.main.append(element('div', 'nl-progress'));
      }
      return;
    }
    if (!state.summary.tiles || state.range === null) {
      this.replaceMain(this.message(state.summary.tiles ? strings.noTiles : strings.noTilesTable));
      return;
    }
    this.main.querySelector(':scope > .nl-progress')?.remove();
    // Counting may have failed before, and worked when asked again.
    if (this.preview.element.parentElement !== this.main) {
      this.main.replaceChildren(this.listPlace, this.preview.element);
      this.listKey = '';
    }
    this.tileset ??= readTileset(state.summary.metadata ?? []);
    this.renderZooms();
    if (!this.started) {
      this.started = true;
      if (this.view.tile) this.show(this.view.tile);
      else this.start();
    } else {
      this.ensureList();
    }
  }

  receive(message: TileMessage): void {
    switch (message.type) {
      case 'tilePage':
        if (message.request === this.firstRequest) {
          this.firstRequest = 0;
          const first = message.page.tiles[0];
          if (first) {
            this.show({ zoom: message.zoom, column: first[0], row: first[1] });
          } else if (this.view.tile) {
            this.preview.show(this.view.tile, null, this.isVector());
          }
        } else if (this.list?.zoom === message.zoom && message.request >= this.listFrom) {
          this.list.receive(message.page);
        }
        return;
      case 'tilePosition':
        if (message.request === this.locateRequest && sameTile(message.key, this.view.tile)) {
          this.list?.select(message.key, message.position);
        }
        return;
      case 'tileContent':
        if (message.request !== this.contentRequest) return;
        if (!message.content && message.request === this.fallbackRequest) {
          this.showFirst(message.key.zoom);
          return;
        }
        this.preview.show(message.key, message.content, this.isVector());
        return;
      case 'tilesError': {
        const { request } = message;
        const detail = `${databaseErrorMessage(message.error, this.strings)} ${message.detail}`;
        if (request === this.contentRequest || request === this.firstRequest) {
          this.preview.fail(this.strings.tilesErrorTitle, detail);
        } else if (request >= this.listFrom && request !== this.locateRequest) {
          this.list?.dispose();
          this.list = undefined;
          this.listPlace.replaceChildren(this.message(this.strings.tilesErrorTitle, detail));
        }
        return;
      }
    }
  }

  dispose(): void {
    this.list?.dispose();
    this.preview.dispose();
  }

  /** Where to start: the tileset's center at the zoom asked for or its own, else the first tile. */
  private start(): void {
    const range = this.state.range;
    if (!range) return;
    const center = this.tileset?.center;
    let zoom = this.view.zoom;
    if (zoom === undefined || zoom < range.min || zoom > range.max) {
      const centerZoom = center?.[2];
      zoom =
        centerZoom !== undefined && centerZoom >= range.min && centerZoom <= range.max
          ? Math.round(centerZoom)
          : range.min;
    }
    if (center) {
      this.show(tileAt(center[0], center[1], zoom), true);
    } else {
      this.showFirst(zoom);
    }
  }

  /** Shows a tile: its content in the preview, and its place in the list. */
  private show(key: TileKey, fallback = false): void {
    this.view.tile = key;
    this.view.zoom = key.zoom;
    this.events.onView(this.view);
    this.addressInput.value = tileAddress(key, this.view.scheme);
    this.markAddress(true);
    if (this.zoomSelect.value !== String(key.zoom)) this.zoomSelect.value = String(key.zoom);
    this.preview.loading(key);
    this.contentRequest = this.request();
    this.fallbackRequest = fallback ? this.contentRequest : 0;
    this.events.send({ type: 'tile', request: this.contentRequest, key });
    // A new list puts the tile in view itself.
    if (!this.ensureList()) this.reveal(key);
  }

  /** Shows the first tile of a zoom level, in the order of the list. */
  private showFirst(zoom: number): void {
    this.firstRequest = this.request();
    this.events.send({
      type: 'tiles',
      request: this.firstRequest,
      zoom,
      start: 0,
      count: 1,
      total: 1,
    });
  }

  /** Puts the tile in view in the list: at once when it's listed, else once it's located. */
  private reveal(key: TileKey): void {
    const list = this.list;
    if (!list || list.zoom !== key.zoom) return;
    const listed = list.has(key);
    list.select(key);
    if (listed) return;
    this.locateRequest = this.request();
    this.events.send({
      type: 'locateTile',
      request: this.locateRequest,
      key,
      total: this.state.counts.get(key.zoom) ?? 0,
    });
  }

  /**
   * Makes the list for the shown zoom level once its tiles are counted, and puts the shown tile
   * in view in it. False when the list there is already the right one.
   */
  private ensureList(): boolean {
    const zoom = this.view.tile?.zoom ?? this.view.zoom;
    const range = this.state.range;
    if (zoom === undefined || !range) return false;
    const total = this.state.counts.get(zoom);
    const key = `${zoom}:${total}`;
    if (key === this.listKey) return false;
    this.listKey = key;
    this.list?.dispose();
    this.list = undefined;
    if (zoom < range.min || zoom > range.max || total === 0) {
      this.listPlace.replaceChildren(this.message(this.strings.noTiles));
      return true;
    }
    if (total === undefined) {
      this.listPlace.replaceChildren(
        this.message(this.state.failed ? this.strings.countFailed : this.strings.countingTiles),
      );
      return true;
    }
    this.listFrom = this.nextRequest;
    this.list = new TileList(zoom, total, this.view.scheme, this.strings, {
      request: (start, count) =>
        this.events.send({ type: 'tiles', request: this.request(), zoom, start, count, total }),
      onPick: (picked) => this.show(picked),
    });
    this.listPlace.replaceChildren(this.list.element);
    if (this.view.tile?.zoom === zoom) this.reveal(this.view.tile);
    return true;
  }

  private renderZooms(): void {
    const range = this.state.range;
    if (!range) return;
    const options = zoomLevels(range).map((zoom) => {
      const count = this.state.counts.get(zoom);
      const option = document.createElement('option');
      option.value = String(zoom);
      option.textContent =
        count === undefined
          ? String(zoom)
          : format(
              this.strings.zoomOption,
              String(zoom),
              count === 1
                ? this.strings.oneTile
                : format(this.strings.tileCount, formatCount(count, this.locale)),
            );
      return option;
    });
    this.zoomSelect.replaceChildren(...options);
    const zoom = this.view.tile?.zoom ?? this.view.zoom;
    if (zoom !== undefined) this.zoomSelect.value = String(zoom);
  }

  /**
   * Another zoom level from the list: the tile under the middle of the one shown, or the
   * level's first tile if there's none there.
   */
  private pickZoom(zoom: number): void {
    const tile = this.view.tile;
    if (!tile) {
      this.showFirst(zoom);
      return;
    }
    if (tile.zoom === zoom) return;
    const levels = zoom - tile.zoom;
    let key: TileKey;
    if (levels < 0) {
      const scale = 2 ** -levels;
      key = { zoom, column: Math.floor(tile.column / scale), row: Math.floor(tile.row / scale) };
    } else {
      // Zooming in by more than a level, a tile in the middle; by one, the north-west quarter.
      const scale = 2 ** levels;
      const middle = levels === 1 ? 0 : scale / 2;
      key = {
        zoom,
        column: tile.column * scale + middle,
        row: tile.row * scale + (levels === 1 ? 1 : middle),
      };
    }
    this.show(key, true);
  }

  /** Saves the tile shown, named by its address as shown, like 14-8723-5412.pbf. */
  private save(): void {
    const tile = this.view.tile;
    if (!tile) return;
    this.events.send({
      type: 'saveTile',
      request: this.request(),
      key: tile,
      name: tileAddress(tile, this.view.scheme).replace(/\//g, '-'),
    });
  }

  private step(step: TileStep): void {
    const tile = this.view.tile;
    const next = tile && stepTile(tile, step);
    if (next) this.show(next);
  }

  private setScheme(scheme: RowScheme): void {
    if (scheme === this.view.scheme) return;
    this.view.scheme = scheme;
    this.events.onView(this.view);
    this.markScheme();
    this.list?.setScheme(scheme);
    this.preview.setScheme(scheme);
    if (this.view.tile) this.addressInput.value = tileAddress(this.view.tile, scheme);
  }

  private markScheme(): void {
    for (const button of this.schemeButtons) {
      const checked = button.dataset.scheme === this.view.scheme;
      button.setAttribute('aria-checked', String(checked));
      button.tabIndex = checked ? 0 : -1;
    }
  }

  private onAddressKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.view.tile) {
      this.addressInput.value = tileAddress(this.view.tile, this.view.scheme);
      this.markAddress(true);
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const key = parseTileAddress(this.addressInput.value, this.view.scheme);
    if (!key) {
      this.markAddress(false);
      return;
    }
    this.show(key);
    this.preview.element.focus({ preventScroll: true });
  }

  private markAddress(valid: boolean): void {
    this.addressInput.setAttribute('aria-invalid', String(!valid));
    this.addressNote.textContent = valid ? '' : this.strings.invalidAddress;
  }

  private isVector(): boolean {
    const format = this.tileset?.format;
    return format !== undefined && !RASTER_FORMATS.has(format);
  }

  private request(): number {
    return this.nextRequest++;
  }

  private replaceMain(content: HTMLElement): void {
    this.list?.dispose();
    this.list = undefined;
    this.main.replaceChildren(content);
  }

  private message(title: string, text?: string, detail?: string): HTMLElement {
    const box = element('div', 'nl-tile-message nl-tiles-message');
    box.append(element('strong', '', title));
    if (text) box.append(element('span', '', text));
    if (detail) box.append(element('span', 'nl-error-detail', detail));
    return box;
  }
}
