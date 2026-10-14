import { decodeTile, type TileLayer } from '../../shared/mvt';
import type { TileContent, ViewerStrings } from '../../shared/protocol';
import {
  IMAGE_KINDS,
  stepTile,
  tileAddress,
  tileKind,
  type RowScheme,
  type TileKey,
  type TileStep,
} from '../../shared/tiles';
import { formatBytes, formatCount } from '../../shared/units';
import { hexDump } from '../detail/format';
import { icons } from '../icons';
import { element, format } from '../views';
import { VectorView } from './vectorView';

/** The buttons that move to another tile, with the keys that do the same. */
const STEPS: {
  step: TileStep;
  icon: keyof typeof icons;
  label: keyof ViewerStrings;
  key: string;
}[] = [
  { step: 'out', icon: 'zoomOut', label: 'zoomOut', key: '−' },
  { step: 'in', icon: 'zoomIn', label: 'zoomIn', key: '+' },
  { step: 'west', icon: 'arrowLeft', label: 'moveWest', key: '←' },
  { step: 'north', icon: 'arrowUp', label: 'moveNorth', key: '↑' },
  { step: 'south', icon: 'arrowDown', label: 'moveSouth', key: '↓' },
  { step: 'east', icon: 'arrowRight', label: 'moveEast', key: '→' },
];

const KEY_STEPS: Record<string, TileStep> = {
  ArrowLeft: 'west',
  ArrowRight: 'east',
  ArrowUp: 'north',
  ArrowDown: 'south',
  '+': 'in',
  '=': 'in',
  '-': 'out',
  _: 'out',
};

/** How long a tile may take before the preview shows that it's loading. */
const LOADING_DELAY = 150;
/** Bytes shown of a tile that's neither an image nor a vector tile. */
const HEAD_BYTES = 256;

export interface TilePreviewEvents {
  onStep(step: TileStep): void;
  /** The user showed or hid a layer; layers are known by name from tile to tile. */
  onLayers(hidden: ReadonlySet<string>): void;
}

/** The selected tile: where it is, what it is, and what it holds, drawn. */
export class TilePreview {
  readonly element: HTMLElement;
  private readonly address: HTMLElement;
  private readonly buttons = new Map<TileStep, HTMLButtonElement>();
  private readonly facts: HTMLElement;
  private readonly body: HTMLElement;
  private key: TileKey | undefined;
  private vector: VectorView | undefined;
  private imageUrl: string | undefined;
  private loadingTimer = 0;

  constructor(
    private readonly strings: ViewerStrings,
    private readonly locale: string,
    private scheme: RowScheme,
    private readonly hidden: Set<string>,
    private readonly events: TilePreviewEvents,
  ) {
    this.element = element('section', 'nl-tile-view');
    this.element.tabIndex = 0;
    const head = element('header', 'nl-tile-head');
    this.address = element('h2', 'nl-tile-address');
    const nav = element('div', 'nl-tile-nav');
    nav.setAttribute('role', 'toolbar');
    nav.setAttribute('aria-label', strings.tileNavigation);
    for (const { step, icon, label, key } of STEPS) {
      const button = element('button', 'nl-icon-button') as HTMLButtonElement;
      button.type = 'button';
      button.innerHTML = icons[icon];
      button.title = `${strings[label]} (${key})`;
      button.setAttribute('aria-label', strings[label]);
      button.addEventListener('click', () => this.events.onStep(step));
      // The arrows keep the keyboard in the preview, where they work as keys too.
      button.addEventListener('mousedown', (event) => event.preventDefault());
      this.buttons.set(step, button);
      nav.append(button);
      if (step === 'in') nav.append(element('span', 'nl-tile-nav-gap'));
    }
    head.append(this.address, nav);
    this.facts = element('p', 'nl-tile-facts');
    this.body = element('div', 'nl-tile-body');
    this.element.append(head, this.facts, this.body);
    this.element.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  /** Shows a tile's place at once and its content when it comes, after a moment's wait. */
  loading(key: TileKey): void {
    this.setKey(key);
    clearTimeout(this.loadingTimer);
    this.loadingTimer = window.setTimeout(() => {
      this.clear();
      this.facts.textContent = '';
      this.body.append(element('div', 'nl-progress'));
    }, LOADING_DELAY);
  }

  show(key: TileKey, content: TileContent | null, vector: boolean): void {
    clearTimeout(this.loadingTimer);
    this.setKey(key);
    this.clear();
    const { strings } = this;
    if (!content) {
      this.facts.textContent = '';
      const note = element('div', 'nl-tile-message');
      note.append(
        element('strong', '', format(strings.noTileAt, tileAddress(key, this.scheme))),
        element('span', '', strings.noTileHint),
      );
      this.body.append(note);
      return;
    }
    const stored = this.sizeText(content);
    if (!content.data) {
      this.facts.textContent = stored;
      this.message(
        content.problem === 'damaged'
          ? format(strings.tileDamaged, content.compression ?? '')
          : format(strings.tileTooLarge, formatBytes(content.size, this.locale)),
      );
      return;
    }
    const kind = tileKind(content.data);
    if (kind === 'empty') {
      this.facts.textContent = stored;
      this.message(strings.emptyTile);
    } else if (IMAGE_KINDS.has(kind)) {
      this.showImage(content.data, kind, stored);
    } else if (kind === 'pbf' || vector) {
      this.showVector(content.data, stored, kind === 'pbf');
    } else {
      this.facts.textContent = stored;
      this.showBytes(strings.tileUnknown, content.data);
    }
  }

  fail(title: string, detail: string): void {
    clearTimeout(this.loadingTimer);
    this.clear();
    this.facts.textContent = '';
    const note = element('div', 'nl-tile-message');
    note.setAttribute('role', 'alert');
    note.append(element('strong', '', title), element('span', 'nl-error-detail', detail));
    this.body.append(note);
  }

  setScheme(scheme: RowScheme): void {
    this.scheme = scheme;
    if (this.key) this.setKey(this.key);
  }

  dispose(): void {
    clearTimeout(this.loadingTimer);
    this.clear();
  }

  private setKey(key: TileKey): void {
    this.key = key;
    const address = tileAddress(key, this.scheme);
    this.address.textContent = address;
    this.element.setAttribute('aria-label', format(this.strings.tileHeading, address));
    for (const [step, button] of this.buttons) {
      button.disabled = stepTile(key, step) === undefined;
    }
  }

  /** Drops what the last tile showed, and the image URL it held on to. */
  private clear(): void {
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    this.imageUrl = undefined;
    this.vector?.dispose();
    this.vector = undefined;
    this.body.replaceChildren();
  }

  private showImage(data: Uint8Array, kind: string, stored: string): void {
    const name = kind === 'jpeg' ? 'JPEG' : kind === 'webp' ? 'WebP' : kind.toUpperCase();
    const facts = [format(this.strings.imageTile, name), stored];
    this.facts.textContent = facts.join(' · ');
    const frame = element('div', 'nl-tile-frame nl-tile-image');
    const image = document.createElement('img');
    image.alt = '';
    this.imageUrl = URL.createObjectURL(new Blob([data as BlobPart], { type: `image/${kind}` }));
    image.addEventListener('load', () => {
      const size = format(
        this.strings.imageSize,
        String(image.naturalWidth),
        String(image.naturalHeight),
      );
      this.facts.textContent = [facts[0], size, stored].join(' · ');
      // Small tiles are shown larger, pixel for pixel.
      image.classList.toggle('nl-pixelated', image.naturalWidth < 256);
    });
    image.addEventListener('error', () => {
      this.clear();
      this.facts.textContent = stored;
      this.showBytes(this.strings.tileUnknown, data);
    });
    image.src = this.imageUrl;
    frame.append(image);
    this.body.append(frame);
  }

  private showVector(data: Uint8Array, stored: string, looksVector: boolean): void {
    const { strings, locale } = this;
    let layers: TileLayer[];
    try {
      layers = decodeTile(data);
    } catch (error) {
      this.facts.textContent = stored;
      if (!looksVector) {
        this.showBytes(strings.tileUnknown, data);
      } else {
        this.showBytes(strings.tileUnreadable, data, (error as Error).message);
      }
      return;
    }
    const features = layers.reduce((sum, layer) => sum + layer.features.length, 0);
    this.facts.textContent = [
      strings.vectorTile,
      count(layers.length, strings.oneLayer, strings.layerCount, locale),
      count(features, strings.oneFeature, strings.layerFeatures, locale),
      stored,
    ].join(' · ');
    if (layers.length === 0) {
      this.message(strings.emptyTile);
      return;
    }
    this.vector = new VectorView(layers, strings, locale, this.hidden, (hidden) =>
      this.events.onLayers(hidden),
    );
    this.body.append(this.vector.element);
  }

  private showBytes(text: string, data: Uint8Array, detail?: string): void {
    const box = element('div', 'nl-tile-bytes');
    box.append(element('p', 'nl-note', text));
    if (detail) box.append(element('p', 'nl-error-detail', detail));
    const hex = Array.from(data.subarray(0, HEAD_BYTES), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    box.append(element('pre', 'nl-tile-hex', hexDump(hex)));
    this.body.append(box);
  }

  private message(text: string): void {
    const note = element('div', 'nl-tile-message');
    note.append(element('strong', '', text));
    this.body.append(note);
  }

  /** The stored size, and how big compressed tiles are once uncompressed. */
  private sizeText(content: TileContent): string {
    const stored = formatBytes(content.size, this.locale);
    if (!content.compression || !content.data) return stored;
    return format(
      this.strings.compressedSize,
      stored,
      content.compression,
      formatBytes(content.data.length, this.locale),
    );
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.target !== this.element || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.vector?.onKey(event)) {
      event.preventDefault();
      return;
    }
    const step = KEY_STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    if (this.key && stepTile(this.key, step)) this.events.onStep(step);
  }
}

function count(n: number, one: string, many: string, locale: string): string {
  return n === 1 ? one : format(many, formatCount(n, locale));
}
