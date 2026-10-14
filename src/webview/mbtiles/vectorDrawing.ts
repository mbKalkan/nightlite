import { featureGeometry, type TileLayer } from '../../shared/mvt';

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
  /** The outline that keeps points apart from what's under them. */
  halo: string;
}

/**
 * Draws a vector tile on a square canvas `size` pixels wide: the tile's square inset by a margin
 * that shows its buffer, each layer in its color, polygons under lines under points. Returns how
 * many features couldn't be drawn because their geometry is damaged.
 */
export function drawVectorTile(
  canvas: HTMLCanvasElement,
  size: number,
  layers: readonly TileLayer[],
  hidden: ReadonlySet<number>,
  style: DrawingStyle,
): number {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(size * ratio);
  canvas.height = Math.round(size * ratio);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const context = canvas.getContext('2d');
  if (!context) return 0;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, size, size);
  const pad = Math.round(size * MARGIN);
  const inner = size - 2 * pad;

  context.save();
  context.setLineDash([4, 4]);
  context.strokeStyle = style.frame;
  context.lineWidth = 1;
  context.strokeRect(pad + 0.5, pad + 0.5, inner - 1, inner - 1);
  context.restore();

  let damaged = 0;
  const geometry = (feature: TileLayer['features'][number]) => {
    try {
      return featureGeometry(feature);
    } catch {
      damaged++;
      return [];
    }
  };
  // Polygons first, then lines and features of no known type, then points on top.
  for (const pass of ['polygons', 'lines', 'points'] as const) {
    layers.forEach((layer, index) => {
      if (hidden.has(index)) return;
      const scale = inner / (layer.extent || 4096);
      const color = style.colors[index];
      const trace = (part: number[], close: boolean) => {
        for (let i = 0; i + 1 < part.length; i += 2) {
          const x = pad + part[i] * scale;
          const y = pad + part[i + 1] * scale;
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        if (close) context.closePath();
      };
      context.strokeStyle = color;
      context.fillStyle = color;
      if (pass === 'polygons') {
        for (const feature of layer.features) {
          if (feature.type !== 3) continue;
          context.beginPath();
          for (const ring of geometry(feature)) trace(ring, true);
          context.globalAlpha = 0.22;
          context.fill('evenodd');
          context.globalAlpha = 0.9;
          context.lineWidth = 1;
          context.stroke();
        }
      } else if (pass === 'lines') {
        context.beginPath();
        for (const feature of layer.features) {
          if (feature.type !== 2 && feature.type !== 0) continue;
          for (const line of geometry(feature)) trace(line, false);
        }
        context.globalAlpha = 1;
        context.lineWidth = 1.5;
        context.stroke();
      } else {
        context.beginPath();
        for (const feature of layer.features) {
          if (feature.type !== 1) continue;
          for (const part of geometry(feature)) {
            for (let i = 0; i + 1 < part.length; i += 2) {
              const x = pad + part[i] * scale;
              const y = pad + part[i + 1] * scale;
              context.moveTo(x + 3, y);
              context.arc(x, y, 3, 0, Math.PI * 2);
            }
          }
        }
        context.globalAlpha = 1;
        context.fill();
        context.strokeStyle = style.halo;
        context.lineWidth = 1;
        context.stroke();
      }
    });
  }
  context.globalAlpha = 1;
  return damaged;
}
