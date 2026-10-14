// Tile addresses and contents. MBTiles stores rows the TMS way, counted from the south; web maps
// and tile URLs count them from the north (XYZ). Keys here always hold the stored row.

/** A tile's place as the tiles table stores it. */
export interface TileKey {
  zoom: number;
  column: number;
  /** The TMS row, counted from the south. */
  row: number;
}

/** How rows are shown and typed: from the north as in tile URLs (XYZ), or as stored (TMS). */
export type RowScheme = 'xyz' | 'tms';

/** The highest zoom level the browser goes to; tile numbers stay exact well past it. */
export const MAX_ZOOM = 30;

/** Turns a row from one scheme into the other; the same formula works both ways. */
export function flipRow(zoom: number, row: number): number {
  return 2 ** zoom - 1 - row;
}

/** The row as shown in a scheme. */
export function shownRow(key: TileKey, scheme: RowScheme): number {
  return scheme === 'tms' ? key.row : flipRow(key.zoom, key.row);
}

/** `z/x/y` in a scheme. */
export function tileAddress(key: TileKey, scheme: RowScheme): string {
  return `${key.zoom}/${key.column}/${shownRow(key, scheme)}`;
}

export const sameTile = (a: TileKey | undefined, b: TileKey | undefined): boolean =>
  a !== undefined &&
  b !== undefined &&
  a.zoom === b.zoom &&
  a.column === b.column &&
  a.row === b.row;

/**
 * Reads a tile address as typed or pasted: `14/8723/5412`, `14 8723 5412`, or a tile URL like
 * `https://…/14/8723/5412.pbf?key=…`, whose last three numbers count. Undefined unless the zoom
 * is at most MAX_ZOOM and the column and row exist at that zoom.
 */
export function parseTileAddress(text: string, scheme: RowScheme): TileKey | undefined {
  const path = text.trim().replace(/[?#].*$/, '');
  const match = /(\d+)[^\d]+(\d+)[^\d]+(\d+)(?:\.[a-z0-9]+)?\/?$/i.exec(path);
  if (!match) return undefined;
  const [zoom, column, shown] = match.slice(1).map(Number);
  const size = 2 ** zoom;
  if (zoom > MAX_ZOOM || column >= size || shown >= size) return undefined;
  return { zoom, column, row: scheme === 'tms' ? shown : flipRow(zoom, shown) };
}

/** The tile holding a place, in web mercator as web maps tile the world. */
export function tileAt(longitude: number, latitude: number, zoom: number): TileKey {
  const size = 2 ** zoom;
  const clamp = (value: number) => Math.min(size - 1, Math.max(0, Math.floor(value)));
  // Mercator stops short of the poles.
  const lat = (Math.max(-85.0511287798, Math.min(85.0511287798, latitude)) * Math.PI) / 180;
  const column = clamp(((longitude + 180) / 360) * size);
  const y = clamp(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * size);
  return { zoom, column, row: flipRow(zoom, y) };
}

/** Directions to a neighbouring tile, as seen on a map with north up. */
export type TileStep = 'west' | 'east' | 'north' | 'south' | 'in' | 'out';

/**
 * The tile next to a tile, or the one above or below it in zoom: zooming in goes to the
 * north-west quarter, zooming out to the tile that holds this one. Undefined past the world's
 * edge or the zoom limits.
 */
export function stepTile(key: TileKey, step: TileStep): TileKey | undefined {
  const { zoom, column, row } = key;
  const size = 2 ** zoom;
  let next: TileKey;
  switch (step) {
    case 'west':
      next = { zoom, column: column - 1, row };
      break;
    case 'east':
      next = { zoom, column: column + 1, row };
      break;
    case 'north':
      next = { zoom, column, row: row + 1 };
      break;
    case 'south':
      next = { zoom, column, row: row - 1 };
      break;
    case 'in':
      // TMS rows grow northwards, so the northern child row is the odd one.
      next = { zoom: zoom + 1, column: column * 2, row: row * 2 + 1 };
      break;
    case 'out':
      next = { zoom: zoom - 1, column: Math.floor(column / 2), row: Math.floor(row / 2) };
      break;
  }
  const nextSize = step === 'in' ? size * 2 : step === 'out' ? size / 2 : size;
  if (next.zoom < 0 || next.zoom > MAX_ZOOM) return undefined;
  if (next.column < 0 || next.row < 0 || next.column >= nextSize || next.row >= nextSize) {
    return undefined;
  }
  return next;
}

/** What a tile's bytes hold, by their first bytes. */
export type TileKind = 'png' | 'jpeg' | 'webp' | 'gif' | 'gzip' | 'zlib' | 'pbf' | 'empty' | 'unknown';

/** Image tiles a browser can show. */
export const IMAGE_KINDS: ReadonlySet<TileKind> = new Set(['png', 'jpeg', 'webp', 'gif']);

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) =>
  bytes.length >= at + signature.length && signature.every((byte, i) => bytes[at + i] === byte);

export function tileKind(bytes: Uint8Array): TileKind {
  if (bytes.length === 0) return 'empty';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp';
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (startsWith(bytes, [0x1f, 0x8b])) return 'gzip';
  // A zlib header: deflate with a window of at most 32 KB, and a check value.
  if (bytes.length >= 2 && (bytes[0] & 0x0f) === 8 && bytes[0] >> 4 <= 7) {
    if (((bytes[0] << 8) | bytes[1]) % 31 === 0) return 'zlib';
  }
  // A vector tile is a list of layers: field 3, length-delimited.
  if (bytes[0] === 0x1a) return 'pbf';
  return 'unknown';
}
