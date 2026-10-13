// What an MBTiles file's metadata says, read the way the MBTiles 1.3 spec defines its keys.

/** A layer of vector tiles, from the `json` key's `vector_layers` and, if present, `tilestats`. */
export interface VectorLayer {
  id: string;
  description?: string;
  minzoom?: number;
  maxzoom?: number;
  /** Field names and their types, in the order the tileset lists them. */
  fields: [string, string][];
  geometry?: string;
  features?: number;
}

export interface Tileset {
  name?: string;
  description?: string;
  format?: string;
  type?: string;
  version?: string;
  minzoom?: number;
  maxzoom?: number;
  /** West, south, east, north. */
  bounds?: [number, number, number, number];
  /** Longitude, latitude and, if given, zoom. */
  center?: number[];
  attribution?: string;
  /** Undefined when the tileset doesn't describe its layers. */
  layers?: VectorLayer[];
  /** Keys outside the spec, as the tileset has them. */
  other: [string, string][];
  /** Keys the spec asks for that are absent. */
  missing: string[];
  /** Keys whose values can't be read as the spec says. */
  invalid: string[];
}

/** Keys the spec defines, in the order the summary shows them. */
export const STANDARD_KEYS = [
  'name',
  'description',
  'format',
  'type',
  'version',
  'minzoom',
  'maxzoom',
  'bounds',
  'center',
  'attribution',
  'json',
] as const;

/** Formats of raster tiles; the rest (pbf) are vector tiles. */
export const RASTER_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp']);

/** The zoom levels between the lowest and highest with tiles, at most 40 of them. */
export function zoomLevels(range: { min: number; max: number }): number[] {
  const levels: number[] = [];
  for (let zoom = range.min; zoom <= range.max && levels.length < 40; zoom++) {
    levels.push(zoom);
  }
  return levels;
}

const numbers = (value: string) =>
  value.split(',').map((part) => (part.trim() === '' ? NaN : Number(part)));

export function readTileset(rows: [string, string][]): Tileset {
  // A key written twice reads as its first value, as most readers take it.
  const values = new Map<string, string>();
  const other: [string, string][] = [];
  for (const [name, value] of rows) {
    if ((STANDARD_KEYS as readonly string[]).includes(name)) {
      if (!values.has(name)) values.set(name, value);
    } else {
      other.push([name, value]);
    }
  }
  const tileset: Tileset = { other, missing: [], invalid: [] };
  const text = (key: string) => {
    const value = values.get(key)?.trim();
    return value ? value : undefined;
  };
  tileset.name = text('name');
  tileset.description = text('description');
  tileset.format = text('format')?.toLowerCase();
  tileset.type = text('type');
  tileset.version = text('version');
  tileset.attribution = text('attribution');

  for (const key of ['minzoom', 'maxzoom'] as const) {
    const value = text(key);
    if (value === undefined) continue;
    const zoom = Number(value);
    if (Number.isInteger(zoom) && zoom >= 0) {
      tileset[key] = zoom;
    } else {
      tileset.invalid.push(key);
    }
  }
  const bounds = text('bounds');
  if (bounds !== undefined) {
    const parts = numbers(bounds);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      tileset.bounds = parts as [number, number, number, number];
    } else {
      tileset.invalid.push('bounds');
    }
  }
  const center = text('center');
  if (center !== undefined) {
    const parts = numbers(center);
    if ((parts.length === 2 || parts.length === 3) && parts.every(Number.isFinite)) {
      tileset.center = parts;
    } else {
      tileset.invalid.push('center');
    }
  }
  const json = text('json');
  if (json !== undefined) {
    const layers = readLayers(json);
    if (layers) {
      tileset.layers = layers;
    } else {
      tileset.invalid.push('json');
    }
  }

  // name and format are required, the rest recommended; vector tiles must describe their layers.
  const expected = ['name', 'format', 'bounds', 'center', 'minzoom', 'maxzoom'];
  if (tileset.format !== undefined && !RASTER_FORMATS.has(tileset.format)) expected.push('json');
  tileset.missing = expected.filter((key) => text(key) === undefined);
  return tileset;
}

/** The layers of the `json` key; undefined when it isn't JSON or has no `vector_layers`. */
function readLayers(json: string): VectorLayer[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  const record = (value: unknown) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const root = record(parsed);
  if (!root || !Array.isArray(root.vector_layers)) return undefined;
  const stats = new Map<string, Record<string, unknown>>();
  const statLayers = record(root.tilestats)?.layers;
  if (Array.isArray(statLayers)) {
    for (const layer of statLayers.map(record)) {
      if (layer && typeof layer.layer === 'string') stats.set(layer.layer, layer);
    }
  }
  const zoom = (value: unknown) => (typeof value === 'number' ? value : undefined);
  return root.vector_layers.flatMap((value): VectorLayer[] => {
    const layer = record(value);
    if (!layer || typeof layer.id !== 'string') return [];
    const fields = Object.entries(record(layer.fields) ?? {}).map(
      ([name, type]): [string, string] => [name, typeof type === 'string' ? type : String(type)],
    );
    const stat = stats.get(layer.id);
    return [
      {
        id: layer.id,
        description:
          typeof layer.description === 'string' && layer.description
            ? layer.description
            : undefined,
        minzoom: zoom(layer.minzoom),
        maxzoom: zoom(layer.maxzoom),
        fields,
        geometry: typeof stat?.geometry === 'string' ? stat.geometry : undefined,
        features: typeof stat?.count === 'number' ? stat.count : undefined,
      },
    ];
  });
}
