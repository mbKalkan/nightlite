import { geometryBounds, positions, type Geometry, type Position } from '../../shared/geometry';

/** Room around the shape, in pixels. */
const PAD = 14;
const POINT_RADIUS = 3.5;

/**
 * A geometry drawn to fit `width` pixels, north up: polygons filled, lines stroked, points as
 * dots, in the theme's chart colors. Curves are drawn through their points.
 */
export function drawGeometry(geometry: Geometry, width: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const bounds = geometryBounds(geometry) ?? [0, 0, 0, 0];
  const [minX, minY, maxX, maxY] = bounds;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const w = Math.round(Math.max(120, Math.min(width, 480)));
  // As tall as the shape is, within reason; a point or a flat line gets a square.
  const ratio = spanX > 0 && spanY > 0 ? Math.min(1.2, Math.max(0.35, spanY / spanX)) : 1;
  const h = Math.round(w * ratio);
  const inner = Math.min(
    spanX > 0 ? (w - 2 * PAD) / spanX : Infinity,
    spanY > 0 ? (h - 2 * PAD) / spanY : Infinity,
  );
  const scale = Number.isFinite(inner) ? inner : 1;
  // Centered: the shape's middle at the canvas's.
  const x = (p: Position) => w / 2 + (p[0] - (minX + maxX) / 2) * scale;
  const y = (p: Position) => h / 2 - (p[1] - (minY + maxY) / 2) * scale;

  const ratioPx = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * ratioPx);
  canvas.height = Math.round(h * ratioPx);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  context.scale(ratioPx, ratioPx);
  const style = getComputedStyle(document.body);
  const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const shape = color('--vscode-charts-blue', '#3794ff');
  const dot = color('--vscode-charts-orange', '#d18616');
  context.lineWidth = 1.5;
  context.lineJoin = 'round';
  context.lineCap = 'round';

  const trace = (points: Position[], close: boolean) => {
    points.forEach((p, i) => (i === 0 ? context.moveTo(x(p), y(p)) : context.lineTo(x(p), y(p))));
    if (close) context.closePath();
  };
  const area = (rings: Position[][]) => {
    context.beginPath();
    for (const ring of rings) trace(ring, true);
    context.globalAlpha = 0.25;
    context.fillStyle = shape;
    context.fill('evenodd');
    context.globalAlpha = 1;
    context.strokeStyle = shape;
    context.stroke();
  };
  const draw = (g: Geometry) => {
    switch (g.kind) {
      case 'point':
        if (!g.point) return;
        context.beginPath();
        context.arc(x(g.point), y(g.point), POINT_RADIUS, 0, Math.PI * 2);
        context.fillStyle = dot;
        context.fill();
        return;
      case 'line':
        context.beginPath();
        trace(g.points, false);
        context.strokeStyle = shape;
        context.stroke();
        return;
      case 'polygon':
        area(g.rings);
        return;
      case 'parts':
        if (g.name === 'CURVEPOLYGON') {
          // Its rings are curves; each is one ring, drawn through its points.
          area(g.parts.map((ring) => [...positions(ring)]));
        } else if (g.name === 'COMPOUNDCURVE') {
          context.beginPath();
          trace([...positions(g)], false);
          context.strokeStyle = shape;
          context.stroke();
        } else {
          g.parts.forEach(draw);
        }
    }
  };
  draw(geometry);
  return canvas;
}
