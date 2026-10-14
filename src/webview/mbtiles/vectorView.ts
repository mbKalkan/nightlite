import { GEOMETRY_NAMES, featureProperties, valueText, type TileLayer } from '../../shared/mvt';
import type { ViewerStrings } from '../../shared/protocol';
import { formatCount } from '../../shared/units';
import { element, format } from '../views';
import { VectorDrawing, layerColors, type DrawingStyle, type DrawnFeature } from './vectorDrawing';

/**
 * A vector tile drawn, its layers with boxes to show or hide them, and the features under the
 * pointer with their attributes. A click keeps those features in view until Escape or a click
 * elsewhere; [ and ] step through the tile's features one by one.
 */
export class VectorView {
  readonly element: HTMLElement;
  private readonly drawing: VectorDrawing;
  private readonly frame: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLCanvasElement;
  private readonly layerList: HTMLElement;
  private readonly featureList: HTMLElement;
  private hovered: DrawnFeature[] = [];
  /** Features kept in view by a click or a step; undefined while following the pointer. */
  private pinned: DrawnFeature[] | undefined;
  private frameRequest = 0;
  private pointer: { x: number; y: number } | undefined;
  private readonly resize = new ResizeObserver(() => this.redraw());
  private readonly theme = new MutationObserver(() => {
    this.renderLayers();
    this.renderFeatures();
    this.redraw();
  });

  constructor(
    layers: readonly TileLayer[],
    private readonly strings: ViewerStrings,
    private readonly locale: string,
    private readonly hidden: Set<string>,
    private readonly onLayers: (hidden: ReadonlySet<string>) => void,
  ) {
    this.drawing = new VectorDrawing(layers);
    this.element = element('div', 'nl-tile-stage');
    this.frame = element('div', 'nl-tile-frame nl-tile-canvas');
    this.frame.title = strings.inspectHint;
    this.canvas = document.createElement('canvas');
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'nl-tile-overlay';
    for (const canvas of [this.canvas, this.overlay]) canvas.setAttribute('aria-hidden', 'true');
    this.frame.append(this.canvas, this.overlay);
    const side = element('div', 'nl-tile-side');
    const layerSection = element('section', 'nl-tile-layers');
    layerSection.append(element('h3', 'nl-heading', strings.tileLayersHeading));
    this.layerList = element('ul', 'nl-tile-layer-list');
    layerSection.append(this.layerList);
    const featureSection = element('section', 'nl-tile-features');
    featureSection.append(element('h3', 'nl-heading', strings.featuresHeading));
    this.featureList = element('div', 'nl-tile-feature-list');
    featureSection.append(this.featureList);
    side.append(layerSection, featureSection);
    this.element.append(this.frame, side);

    this.overlay.addEventListener('mousemove', (event) => {
      this.pointer = { x: event.offsetX, y: event.offsetY };
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = requestAnimationFrame(() => this.hover());
    });
    this.overlay.addEventListener('mouseleave', () => {
      this.pointer = undefined;
      this.setHovered([]);
    });
    this.overlay.addEventListener('click', () => {
      const hits = this.hits();
      this.pinned = hits.length && !sameFeatures(hits, this.pinned) ? hits : undefined;
      this.update();
    });
    this.renderLayers();
    this.renderFeatures();
    this.resize.observe(this.frame);
    this.theme.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  /** Features drawn but left out because their geometry is damaged. */
  get damaged(): number {
    return this.drawing.damaged;
  }

  /** Escape lets go of kept features; [ and ] step through them. True when the key was used. */
  onKey(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      if (!this.pinned) return false;
      this.pinned = undefined;
      this.update();
      return true;
    }
    if (event.key !== '[' && event.key !== ']') return false;
    const visible = this.drawing.features.filter((feature) => !this.isHidden(feature.layer));
    if (visible.length === 0) return true;
    // Topmost first, as under the pointer.
    visible.reverse();
    const at = this.pinned ? visible.indexOf(this.pinned[0]) : -1;
    const step = event.key === ']' ? 1 : -1;
    const next = at < 0 ? (step > 0 ? 0 : visible.length - 1) : at + step;
    this.pinned = [visible[(next + visible.length) % visible.length]];
    this.update();
    return true;
  }

  dispose(): void {
    cancelAnimationFrame(this.frameRequest);
    this.resize.disconnect();
    this.theme.disconnect();
  }

  private hover(): void {
    this.setHovered(this.hits());
  }

  private hits(): DrawnFeature[] {
    if (!this.pointer) return [];
    return this.drawing.hit(this.pointer.x, this.pointer.y, this.size(), this.hiddenIndexes());
  }

  private setHovered(hits: DrawnFeature[]): void {
    if (sameFeatures(hits, this.hovered)) return;
    this.hovered = hits;
    this.overlay.classList.toggle('nl-pointing', hits.length > 0);
    this.update();
  }

  private update(): void {
    this.renderFeatures();
    this.paintHighlight();
  }

  private size(): number {
    return Math.floor(this.frame.clientWidth);
  }

  private isHidden(layer: number): boolean {
    return this.hidden.has(this.drawing.layers[layer].name);
  }

  private hiddenIndexes(): Set<number> {
    const hidden = new Set<number>();
    this.drawing.layers.forEach((layer, index) => {
      if (this.hidden.has(layer.name)) hidden.add(index);
    });
    return hidden;
  }

  private style(): DrawingStyle {
    const style = getComputedStyle(document.documentElement);
    return {
      colors: layerColors(this.drawing.layers.length),
      frame: style.getPropertyValue('--vscode-descriptionForeground').trim() || '#888',
      halo: style.getPropertyValue('--vscode-editor-background').trim() || '#000',
    };
  }

  private redraw(): void {
    const size = this.size();
    if (size <= 0) return;
    this.drawing.draw(this.canvas, size, this.hiddenIndexes(), this.style());
    this.paintHighlight();
  }

  private paintHighlight(): void {
    const size = this.size();
    if (size <= 0) return;
    const shown = (this.pinned ?? this.hovered).filter((feature) => !this.isHidden(feature.layer));
    this.drawing.highlight(this.overlay, size, shown, this.style());
  }

  /** Each layer with its color, what it holds, and a box to show or hide it. */
  private renderLayers(): void {
    const { strings, locale } = this;
    const colors = layerColors(this.drawing.layers.length);
    this.layerList.replaceChildren(
      ...this.drawing.layers.map((layer, index) => {
        const item = element('li', 'nl-tile-layer');
        const label = element('label', 'nl-tile-layer-label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'nl-checkbox';
        box.checked = !this.hidden.has(layer.name);
        box.addEventListener('change', () => {
          if (box.checked) this.hidden.delete(layer.name);
          else this.hidden.add(layer.name);
          this.onLayers(this.hidden);
          this.redraw();
          this.renderFeatures();
        });
        const swatch = element('span', 'nl-swatch');
        swatch.style.background = colors[index];
        label.append(box, swatch, element('span', 'nl-tile-layer-name', layer.name));
        const types = [0, 0, 0, 0];
        for (const feature of layer.features) types[feature.type]++;
        const facts = [
          types[1] && count(types[1], strings.onePoint, strings.pointCount, locale),
          types[2] && count(types[2], strings.oneLine, strings.lineCount, locale),
          types[3] && count(types[3], strings.onePolygon, strings.polygonCount, locale),
          types[0] && format(strings.otherCount, formatCount(types[0], locale)),
          layer.extent !== 4096 && format(strings.layerExtent, formatCount(layer.extent, locale)),
        ].filter((fact): fact is string => typeof fact === 'string');
        if (layer.features.length === 0) facts.push(count(0, '', strings.layerFeatures, locale));
        item.append(label, element('span', 'nl-tile-layer-facts', facts.join(' · ')));
        return item;
      }),
    );
  }

  /** The features under the pointer, or kept in view, each with its attributes. */
  private renderFeatures(): void {
    const { strings } = this;
    const shown = (this.pinned ?? this.hovered).filter((feature) => !this.isHidden(feature.layer));
    this.featureList.classList.toggle('nl-pinned', this.pinned !== undefined);
    if (shown.length === 0) {
      this.featureList.replaceChildren(element('p', 'nl-note', strings.inspectHint));
      return;
    }
    const colors = layerColors(this.drawing.layers.length);
    this.featureList.replaceChildren(
      ...shown.map((drawn) => {
        const layer = this.drawing.layers[drawn.layer];
        const feature = layer.features[drawn.index];
        const card = element('article', 'nl-tile-feature');
        const head = element('header', 'nl-tile-feature-head');
        const swatch = element('span', 'nl-swatch');
        swatch.style.background = colors[drawn.layer];
        const facts: string[] = [GEOMETRY_NAMES[feature.type]];
        if (feature.id !== undefined) facts.push(format(strings.featureId, String(feature.id)));
        head.append(
          swatch,
          element('span', 'nl-tile-layer-name', layer.name),
          element('span', 'nl-tile-layer-facts', facts.join(' · ')),
        );
        card.append(head);
        const properties = featureProperties(layer, feature);
        if (properties.length === 0) {
          card.append(element('p', 'nl-note', strings.noAttributes));
        } else {
          const list = element('dl', 'nl-tile-attributes');
          for (const [name, value] of properties) {
            const term = element('dt', '', name);
            const description = element('dd', '');
            description.append(
              element('span', `nl-attribute-value nl-attribute-${value.type}`, valueText(value)),
              element('span', 'nl-attribute-type', value.type),
            );
            list.append(term, description);
          }
          card.append(list);
        }
        return card;
      }),
    );
  }
}

function sameFeatures(a: readonly DrawnFeature[], b: readonly DrawnFeature[] | undefined) {
  return b !== undefined && a.length === b.length && a.every((feature, i) => feature === b[i]);
}

function count(n: number, one: string, many: string, locale: string): string {
  return n === 1 ? one : format(many, formatCount(n, locale));
}
