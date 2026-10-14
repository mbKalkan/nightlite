import { featureGeometry, type GeometryType, type TileLayer } from '../../shared/mvt';

/** The theme's chart colors, one per layer in turn; fallbacks for themes that leave them out. */
const PALETTE: readonly [string, string][] = [
  ['--vscode-charts-blue', '#3794ff'],
  ['--vscode-charts-orange', '#d18616'],
  ['--vscode-charts-green', '#89d185'],
  ['--vscode-charts-purple', '#b180d7'],
  ['--vscode-charts-red', '#f14c4c'],
  ['--vscode-charts-yellow', '#cca700'],
  ['--vscode-terminal-ansiCyan', '#11a8cd'],
  ['--vscode-terminal-ansiMagenta', '#bc3fbc'],
];

/** Room around the tile's square for what lies in its buffer, as a share of the drawing. */
const MARGIN = 1 / 16;
const POINT_RADIUS = 3;
/**
 * How near the pointer, in pixels, a line or point has to be to count as under it. Polygons count
 * only from inside, or right on their edge: in a dense block, a few pixels reach the next one.
 */
const REACH = { 1: 5, 2: 4, 0: 4, 3: 1 } as const;
/** Features listed under the pointer at most. */
const HIT_LIMIT = 10;

export function layerColors(count: number): string[] {
  const style = getComputedStyle(document.documentElement);
  return Array.from({ length: count }, (_, i) => {
    const [variable, fallback] = PALETTE[i % PALETTE.length];
    return style.getPropertyValue(variable).trim() || fallback;
  });
}

export interface DrawingStyle {
  colors: readonly string[];
  /** The tile's square. */
  frame: string;
  /** The outline that keeps points and highlights apart from what's under them. */
  halo: string;
}

/** A feature as drawn: its layer, its place in the layer, and its geometry in tile units. */
export interface DrawnFeature {
  layer: number;
  index: number;
  type: GeometryType;
  parts: number[][];
  /** West, north, east and south edges, in tile units. */
  box: [number, number, number, number];
}

/** Polygons first, then lines and features of no known type, then points on top. */
const PASS: Record<GeometryType, number> = { 3: 0, 2: 1, 0: 1, 1: 2 };

/**
 * A vector tile ready to draw on a square canvas and to find features in: the tile's square inset
 * by a margin that shows its buffer, each layer in its color. Geometry is read once per tile.
 */
export class VectorDrawing {
  /** Every feature with readable geometry, in the order they're drawn. */
  readonly features: DrawnFeature[] = [];
  /** Features whose geometry is damaged, left out. */
  readonly damaged: number = 0;

  constructor(readonly layers: readonly TileLayer[]) {
    let damaged = 0;
    for (const pass of [0, 1, 2]) {
      layers.forEach((layer, index) => {
        layer.features.forEach((feature, at) => {
          if (PASS[feature.type] !== pass) return;
          let parts: number[][];
          try {
            parts = featureGeometry(feature);
          } catch {
            damaged++;
            return;
          }
          this.features.push({
            layer: index,
            index: at,
            type: feature.type,
            parts,
            box: bounds(parts),
          });
        });
      });
    }
    this.damaged = damaged;
  }

  /** Draws the tile `size` pixels wide, leaving hidden layers out. */
  draw(canvas: HTMLCanvasElement, size: number, hidden: ReadonlySet<number>, style: DrawingStyle) {
    const context = prepare(canvas, size);
    if (!context) return;
    const pad = Math.round(size * MARGIN);
    const inner = size - 2 * pad;
    context.save();
    context.setLineDash([4, 4]);
    context.strokeStyle = style.frame;
    context.lineWidth = 1;
    context.strokeRect(pad + 0.5, pad + 0.5, inner - 1, inner - 1);
    context.restore();
    for (const feature of this.features) {
      if (hidden.has(feature.layer)) continue;
      const color = style.colors[feature.layer];
      context.strokeStyle = color;
      context.fillStyle = color;
      this.trace(context, feature, size);
      if (feature.type === 3) {
        context.globalAlpha = 0.22;
        context.fill('evenodd');
        context.globalAlpha = 0.9;
        context.lineWidth = 1;
        context.stroke();
      } else if (feature.type === 1) {
        context.globalAlpha = 1;
        context.fill();
        context.strokeStyle = style.halo;
        context.lineWidth = 1;
        context.stroke();
      } else {
        context.globalAlpha = 1;
        context.lineWidth = 1.5;
        context.stroke();
      }
    }
    context.globalAlpha = 1;
  }

  /** Draws features over the tile, outlined so they stand out: the ones under the pointer. */
  highlight(
    canvas: HTMLCanvasElement,
    size: number,
    features: readonly DrawnFeature[],
    style: DrawingStyle,
  ) {
    const context = prepare(canvas, size);
    if (!context) return;
    // The lowest first, so the topmost ends up on top here too.
    for (const feature of [...features].reverse()) {
      const color = style.colors[feature.layer];
      this.trace(context, feature, size, 1.5);
      if (feature.type === 3) {
        context.globalAlpha = 0.35;
        context.fillStyle = color;
        context.fill('evenodd');
        context.globalAlpha = 1;
      } else if (feature.type === 1) {
        context.fillStyle = color;
        context.fill();
      }
      context.strokeStyle = style.halo;
      context.lineWidth = 5;
      context.stroke();
      context.strokeStyle = color;
      context.lineWidth = feature.type === 1 ? 2 : 2.5;
      context.stroke();
    }
  }

  /**
   * The features under a point of the drawing, in pixels from its corner: topmost first, at most
   * HIT_LIMIT. A point or line counts within a few pixels, a polygon anywhere inside it.
   */
  hit(x: number, y: number, size: number, hidden: ReadonlySet<number>): DrawnFeature[] {
    const pad = Math.round(size * MARGIN);
    const inner = size - 2 * pad;
    const found: DrawnFeature[] = [];
    for (let i = this.features.length - 1; i >= 0 && found.length < HIT_LIMIT; i--) {
      const feature = this.features[i];
      if (hidden.has(feature.layer)) continue;
      const scale = inner / (this.layers[feature.layer].extent || 4096);
      const reach = REACH[feature.type] / scale;
      const tx = (x - pad) / scale;
      const ty = (y - pad) / scale;
      const [west, north, east, south] = feature.box;
      if (tx < west - reach || tx > east + reach || ty < north - reach || ty > south + reach) {
        continue;
      }
      if (touches(feature, tx, ty, reach)) found.push(feature);
    }
    return found;
  }

  private trace(context: CanvasRenderingContext2D, feature: DrawnFeature, size: number, grow = 0) {
    const pad = Math.round(size * MARGIN);
    const scale = (size - 2 * pad) / (this.layers[feature.layer].extent || 4096);
    context.beginPath();
    for (const part of feature.parts) {
      for (let i = 0; i + 1 < part.length; i += 2) {
        const x = pad + part[i] * scale;
        const y = pad + part[i + 1] * scale;
        if (feature.type === 1) {
          const radius = POINT_RADIUS + grow;
          context.moveTo(x + radius, y);
          context.arc(x, y, radius, 0, Math.PI * 2);
        } else if (i === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }
      if (feature.type === 3) context.closePath();
    }
  }
}

function prepare(canvas: HTMLCanvasElement, size: number): CanvasRenderingContext2D | null {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(size * ratio);
  canvas.height = Math.round(size * ratio);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, size, size);
  return context;
}

function bounds(parts: number[][]): [number, number, number, number] {
  let [west, north, east, south] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    for (let i = 0; i + 1 < part.length; i += 2) {
      west = Math.min(west, part[i]);
      east = Math.max(east, part[i]);
      north = Math.min(north, part[i + 1]);
      south = Math.max(south, part[i + 1]);
    }
  }
  return [west, north, east, south];
}

/** Whether a point lies within `reach` of a feature, or inside it if it's a polygon. */
function touches(feature: DrawnFeature, x: number, y: number, reach: number): boolean {
  if (feature.type === 1) {
    return feature.parts.some((part) => {
      for (let i = 0; i + 1 < part.length; i += 2) {
        if (Math.hypot(part[i] - x, part[i + 1] - y) <= reach) return true;
      }
      return false;
    });
  }
  let inside = false;
  for (const part of feature.parts) {
    for (let i = 2; i + 1 < part.length; i += 2) {
      const [x1, y1, x2, y2] = [part[i - 2], part[i - 1], part[i], part[i + 1]];
      if (segmentDistance(x, y, x1, y1, x2, y2) <= reach) return true;
      // Even-odd: count the edges a ray to the east crosses.
      if (feature.type === 3 && y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function segmentDistance(x: number, y: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}
