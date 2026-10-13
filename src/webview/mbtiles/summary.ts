import { RASTER_FORMATS, readTileset, zoomLevels, type Tileset } from '../../shared/mbtiles';
import type {
  DatabaseError,
  FileInfo,
  MbtilesSummary,
  ViewerStrings,
  ZoomRange,
} from '../../shared/protocol';
import { formatCount } from '../../shared/units';
import { databaseErrorMessage, element, format, overviewView } from '../views';

/** What the viewer knows about an MBTiles file so far; tile counts arrive one level at a time. */
export interface TilesState {
  summary?: MbtilesSummary;
  error?: { error: DatabaseError; detail: string };
  /** Undefined until counted; null when there are no tiles. */
  range?: ZoomRange | null;
  counts: Map<number, number>;
  counting: boolean;
  failed: boolean;
}

export function countsComplete(state: TilesState): boolean {
  if (state.range === undefined) return false;
  return state.range === null || zoomLevels(state.range).every((zoom) => state.counts.has(zoom));
}

/**
 * An MBTiles file's first view: what the tileset is, its tiles by zoom level, its vector
 * layers, its metadata as the spec reads it, and the file's own facts.
 */
export class MbtilesView {
  readonly element: HTMLElement;
  private readonly zooms: HTMLElement;
  private tileset: Tileset | undefined;

  constructor(
    private readonly file: FileInfo,
    private readonly locale: string,
    private readonly strings: ViewerStrings,
    private readonly state: TilesState,
  ) {
    this.element = element('div', 'nl-page nl-mbtiles');
    this.zooms = element('section', 'nl-section nl-zooms');
    this.render();
  }

  /** Draws the whole page, as when the metadata arrives. */
  render(): void {
    const { strings, state } = this;
    const parts: HTMLElement[] = [];
    this.tileset = state.summary?.metadata ? readTileset(state.summary.metadata) : undefined;
    parts.push(this.heading());
    if (state.error) {
      const box = element('div', 'nl-notice');
      box.setAttribute('role', 'alert');
      box.append(
        element('strong', '', strings.mbtilesErrorTitle),
        element('span', '', databaseErrorMessage(state.error.error, strings)),
        element('span', 'nl-error-detail', state.error.detail),
      );
      parts.push(box);
    } else if (!state.summary) {
      parts.push(element('div', 'nl-progress'));
    } else {
      this.renderZooms();
      parts.push(this.zooms);
      if (this.tileset?.layers?.length) parts.push(this.layers(this.tileset));
      parts.push(this.metadata());
    }
    const file = element('section', 'nl-section');
    file.append(
      element('h2', 'nl-heading', strings.fileHeading),
      overviewFacts(this.file, this.locale, strings),
    );
    parts.push(file);
    this.element.replaceChildren(...parts);
  }

  /** Redraws the tiles by zoom level, as each level's count arrives. */
  renderZooms(): void {
    const { strings, state, locale } = this;
    const parts: HTMLElement[] = [element('h2', 'nl-heading', strings.tilesHeading)];
    const tiles = state.summary?.tiles;
    if (!tiles) {
      parts.push(element('p', 'nl-note', strings.noTilesTable));
      this.zooms.replaceChildren(...parts);
      return;
    }
    if (state.range === null) {
      parts.push(element('p', 'nl-note', strings.noTiles));
    } else if (state.range === undefined) {
      parts.push(
        element('p', 'nl-note', state.failed ? strings.countFailed : strings.countingTiles),
      );
    } else {
      const levels = zoomLevels(state.range);
      const most = Math.max(1, ...levels.map((zoom) => state.counts.get(zoom) ?? 0));
      const table = element('div', 'nl-zoom-table');
      table.setAttribute('role', 'table');
      const head = element('div', 'nl-zoom-row nl-zoom-head');
      head.setAttribute('role', 'row');
      for (const label of [strings.zoomColumn, strings.tilesHeading, '']) {
        const cell = element('span', '', label);
        cell.setAttribute('role', 'columnheader');
        head.append(cell);
      }
      table.append(head);
      for (const zoom of levels) {
        const count = state.counts.get(zoom);
        const row = element('div', `nl-zoom-row${count === undefined ? ' nl-pending' : ''}`);
        row.setAttribute('role', 'row');
        const bar = element('span', 'nl-zoom-bar');
        const fill = element('span', 'nl-zoom-fill');
        fill.style.width = `${count ? Math.max(0.5, (count / most) * 100) : 0}%`;
        bar.append(fill);
        const cells = [
          element('span', 'nl-zoom-level', String(zoom)),
          element(
            'span',
            'nl-zoom-count',
            count === undefined ? (state.failed ? '—' : '…') : formatCount(count, locale),
          ),
          bar,
        ];
        for (const cell of cells) cell.setAttribute('role', 'cell');
        row.append(...cells);
        table.append(row);
      }
      parts.push(table);
      if (countsComplete(state)) {
        const total = levels.reduce((sum, zoom) => sum + (state.counts.get(zoom) ?? 0), 0);
        const tilesText =
          total === 1 ? strings.oneTile : format(strings.tileCount, formatCount(total, locale));
        parts.push(
          element(
            'p',
            'nl-note',
            state.range.min === state.range.max
              ? format(strings.tilesAtZoom, tilesText, String(state.range.min))
              : format(
                  strings.tilesAtZooms,
                  tilesText,
                  String(state.range.min),
                  String(state.range.max),
                ),
          ),
        );
      } else {
        parts.push(
          element('p', 'nl-note', state.failed ? strings.countFailed : strings.countingTiles),
        );
      }
      parts.push(...this.mismatches(state.range).map(warning));
    }
    if (tiles === 'view') parts.push(element('p', 'nl-note', strings.tilesIsView));
    this.zooms.replaceChildren(...parts);
  }

  private heading(): HTMLElement {
    const { strings } = this;
    const header = element('header', 'nl-mbtiles-head');
    const tileset = this.tileset;
    header.append(element('h1', 'nl-title', tileset?.name ?? this.file.fileName));
    const kind = [strings.formatMbtiles];
    if (tileset?.format) kind.push(this.formatText(tileset.format));
    header.append(element('p', 'nl-subtitle', kind.join(' · ')));
    if (tileset?.description) header.append(element('p', 'nl-description', tileset.description));
    return header;
  }

  private layers(tileset: Tileset): HTMLElement {
    const { strings, locale } = this;
    const section = element('section', 'nl-section');
    section.append(
      element('h2', 'nl-heading', `${strings.layersHeading} (${tileset.layers?.length ?? 0})`),
    );
    const list = element('ul', 'nl-layers');
    for (const layer of tileset.layers ?? []) {
      const item = element('li', 'nl-layer');
      const head = element('div', 'nl-layer-head');
      head.append(element('span', 'nl-layer-name', layer.id));
      const facts: string[] = [];
      if (layer.geometry) facts.push(layer.geometry);
      if (layer.features !== undefined) {
        facts.push(format(strings.layerFeatures, formatCount(layer.features, locale)));
      }
      if (layer.minzoom !== undefined && layer.maxzoom !== undefined) {
        facts.push(format(strings.layerZoom, String(layer.minzoom), String(layer.maxzoom)));
      }
      if (facts.length) head.append(element('span', 'nl-layer-facts', facts.join(' · ')));
      item.append(head);
      if (layer.description) item.append(element('p', 'nl-layer-description', layer.description));
      const fields = element('p', 'nl-layer-fields');
      if (layer.fields.length === 0) {
        fields.append(element('span', 'nl-note', strings.noFields));
      }
      for (const [name, type] of layer.fields) {
        const field = element('span', 'nl-field');
        field.append(
          element('span', 'nl-field-name', name),
          element('span', 'nl-field-type', type),
        );
        fields.append(field);
      }
      item.append(fields);
      list.append(item);
    }
    section.append(list);
    return section;
  }

  private metadata(): HTMLElement {
    const { strings } = this;
    const section = element('section', 'nl-section');
    section.append(element('h2', 'nl-heading', strings.metadataHeading));
    const tileset = this.tileset;
    if (!tileset) {
      section.append(element('p', 'nl-note', strings.noMetadata));
      return section;
    }
    const rows: [string, string | undefined][] = [
      [strings.mdName, tileset.name],
      [strings.mdDescription, tileset.description],
      [
        strings.mdFormat,
        tileset.format && `${tileset.format} (${this.formatText(tileset.format)})`,
      ],
      [strings.mdType, tileset.type],
      [strings.mdVersion, tileset.version],
      [strings.mdZoom, zoomText(tileset.minzoom, tileset.maxzoom)],
      [
        strings.mdBounds,
        tileset.bounds && format(strings.boundsValue, ...tileset.bounds.map(String)),
      ],
      [strings.mdCenter, tileset.center && this.centerText(tileset.center)],
      [strings.mdAttribution, tileset.attribution],
      ...tileset.other,
    ];
    const list = element('dl', 'nl-facts');
    for (const [term, value] of rows) {
      if (value === undefined || value === '') continue;
      list.append(element('dt', '', term), element('dd', '', value));
    }
    section.append(list);
    if (tileset.missing.length) {
      section.append(warning(format(strings.missingMetadata, tileset.missing.join(', '))));
    }
    if (tileset.invalid.length) {
      section.append(warning(format(strings.invalidMetadata, tileset.invalid.join(', '))));
    }
    return section;
  }

  /** Where the metadata's zoom levels disagree with the tiles', once all are counted. */
  private mismatches(range: ZoomRange): string[] {
    const tileset = this.tileset;
    if (!tileset || !countsComplete(this.state)) return [];
    const found: string[] = [];
    if (tileset.minzoom !== undefined && tileset.minzoom !== range.min) {
      found.push(format(this.strings.minzoomMismatch, String(tileset.minzoom), String(range.min)));
    }
    if (tileset.maxzoom !== undefined && tileset.maxzoom !== range.max) {
      found.push(format(this.strings.maxzoomMismatch, String(tileset.maxzoom), String(range.max)));
    }
    return found;
  }

  private formatText(format: string): string {
    return RASTER_FORMATS.has(format) ? this.strings.rasterTiles : this.strings.vectorTiles;
  }

  private centerText(center: number[]): string {
    const place = format(this.strings.centerValue, String(center[0]), String(center[1]));
    return center.length > 2 ? format(this.strings.centerZoom, place, String(center[2])) : place;
  }
}

function zoomText(min: number | undefined, max: number | undefined): string | undefined {
  if (min === undefined && max === undefined) return undefined;
  return `${min ?? '?'}–${max ?? '?'}`;
}

function warning(text: string): HTMLElement {
  const note = element('p', 'nl-warning', text);
  return note;
}

/** The file's facts from its header, without the overview's own title. */
function overviewFacts(file: FileInfo, locale: string, strings: ViewerStrings): HTMLElement {
  const overview = overviewView(file, locale, strings);
  return overview.querySelector('.nl-facts') ?? overview;
}
