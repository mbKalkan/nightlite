/**
 * GeoPackage geometries (D-024): the GeoPackageBinary header, then the geometry as Well-Known
 * Binary. ISO WKB is what GeoPackage writes, with 1000, 2000 and 3000 added to the type for Z, M
 * and ZM; the EWKB flags some writers use are read too.
 */

/** The header before the WKB: the SRS, the envelope as stored, and where the WKB starts. */
export interface GeoPackageHeader {
  srsId: number;
  /** minX, maxX, minY, maxY, then minZ, maxZ and minM, maxM when stored; null when not. */
  envelope: number[] | null;
  empty: boolean;
  /** A GeoPackage extension's own geometry, not WKB. */
  extended: boolean;
  /** Where the WKB starts. */
  start: number;
}

/** Envelope doubles by the envelope indicator in the flags: none, XY, XYZ, XYM, XYZM. */
const ENVELOPE_SIZES = [0, 4, 6, 6, 8];

export function readGeoPackageHeader(bytes: Uint8Array): GeoPackageHeader | undefined {
  // 'GP', version 0 (GeoPackage 1.x), flags.
  if (bytes.length < 8 || bytes[0] !== 0x47 || bytes[1] !== 0x50 || bytes[2] !== 0) {
    return undefined;
  }
  const flags = bytes[3];
  const indicator = (flags >> 1) & 0b111;
  if (indicator >= ENVELOPE_SIZES.length) return undefined;
  const little = (flags & 1) === 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const doubles = ENVELOPE_SIZES[indicator];
  const start = 8 + doubles * 8;
  let envelope: number[] | null = null;
  if (doubles > 0 && bytes.length >= start) {
    envelope = Array.from({ length: doubles }, (_, i) => view.getFloat64(8 + i * 8, little));
  }
  return {
    srsId: view.getInt32(4, little),
    envelope,
    empty: (flags & 0b10000) !== 0,
    extended: (flags & 0b100000) !== 0,
    start,
  };
}

const TYPE_NAMES = [
  'GEOMETRY',
  'POINT',
  'LINESTRING',
  'POLYGON',
  'MULTIPOINT',
  'MULTILINESTRING',
  'MULTIPOLYGON',
  'GEOMETRYCOLLECTION',
  'CIRCULARSTRING',
  'COMPOUNDCURVE',
  'CURVEPOLYGON',
  'MULTICURVE',
  'MULTISURFACE',
] as const;

export type GeometryName = (typeof TYPE_NAMES)[number];

/** A geometry's coordinates: x, y, then z and m when it has them. */
export type Position = number[];

export type Geometry = {
  name: GeometryName;
  /** '' for XY, or 'Z', 'M', 'ZM'. */
  dimensions: '' | 'Z' | 'M' | 'ZM';
} & (
  | { kind: 'point'; point: Position | null }
  | { kind: 'line'; points: Position[] }
  | { kind: 'polygon'; rings: Position[][] }
  | { kind: 'parts'; parts: Geometry[] }
);

/** A geometry that can't be read: cut short, or of a kind this doesn't know. */
export class GeometryFormatError extends Error {}

/** The WKB type: its name and dimensions, from the ISO codes or the EWKB flags. */
function wkbType(raw: number): { name: GeometryName; z: boolean; m: boolean; srid: boolean } {
  let code = raw;
  let z = false;
  let m = false;
  let srid = false;
  if (code > 0x0fffffff) {
    z = (code & 0x80000000) !== 0;
    m = (code & 0x40000000) !== 0;
    srid = (code & 0x20000000) !== 0;
    code &= 0x0fffffff;
  }
  const iso = Math.floor(code / 1000);
  if (iso === 1 || iso === 3) z = true;
  if (iso === 2 || iso === 3) m = true;
  code %= 1000;
  const name = TYPE_NAMES[code];
  if (!name || code === 0) throw new GeometryFormatError(`Unknown geometry type ${raw}`);
  return { name, z, m, srid };
}

/** Reads WKB from `offset`, for as long as the bytes go. */
class WkbReader {
  private readonly view: DataView;
  offset: number;

  constructor(
    private readonly bytes: Uint8Array,
    offset: number,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = offset;
  }

  geometry(depth = 0): Geometry {
    if (depth > 32) throw new GeometryFormatError('Geometries nested too deep');
    this.need(5);
    const little = this.bytes[this.offset] === 1;
    const type = wkbType(this.view.getUint32(this.offset + 1, little));
    this.offset += 5;
    if (type.srid) this.uint(little);
    const size = 2 + (type.z ? 1 : 0) + (type.m ? 1 : 0);
    const dimensions = `${type.z ? 'Z' : ''}${type.m ? 'M' : ''}` as Geometry['dimensions'];
    const base = { name: type.name, dimensions };
    switch (type.name) {
      case 'POINT': {
        const point = this.position(size, little);
        // An empty point is all NaN.
        return { ...base, kind: 'point', point: point.every(Number.isNaN) ? null : point };
      }
      case 'LINESTRING':
      case 'CIRCULARSTRING':
        return { ...base, kind: 'line', points: this.positions(size, little) };
      case 'POLYGON': {
        const rings = this.count(little, 4);
        return {
          ...base,
          kind: 'polygon',
          rings: Array.from({ length: rings }, () => this.positions(size, little)),
        };
      }
      default: {
        const parts = this.count(little, 5);
        return {
          ...base,
          kind: 'parts',
          parts: Array.from({ length: parts }, () => this.geometry(depth + 1)),
        };
      }
    }
  }

  private positions(size: number, little: boolean): Position[] {
    const count = this.count(little, size * 8);
    return Array.from({ length: count }, () => this.position(size, little));
  }

  private position(size: number, little: boolean): Position {
    this.need(size * 8);
    const position = Array.from({ length: size }, (_, i) =>
      this.view.getFloat64(this.offset + i * 8, little),
    );
    this.offset += size * 8;
    return position;
  }

  /** A count, checked against the bytes left so a damaged one can't ask for gigabytes. */
  private count(little: boolean, least: number): number {
    const count = this.uint(little);
    if (count * least > this.bytes.length - this.offset) {
      throw new GeometryFormatError('The geometry is cut short');
    }
    return count;
  }

  private uint(little: boolean): number {
    this.need(4);
    const value = this.view.getUint32(this.offset, little);
    this.offset += 4;
    return value;
  }

  private need(bytes: number): void {
    if (this.offset + bytes > this.bytes.length) {
      throw new GeometryFormatError('The geometry is cut short');
    }
  }
}

/** A GeoPackage geometry BLOB, read whole; undefined when the BLOB isn't one. */
export function readGeoPackageGeometry(
  bytes: Uint8Array,
): { header: GeoPackageHeader; geometry: Geometry } | undefined {
  const header = readGeoPackageHeader(bytes);
  if (!header || header.extended) return undefined;
  return { header, geometry: new WkbReader(bytes, header.start).geometry() };
}

/**
 * What a geometry is, from its first bytes alone, as the grid shows it: `MULTIPOLYGON`,
 * `POINT Z`. Undefined when the bytes aren't a GeoPackage geometry or stop too soon.
 */
export function geometryLabel(head: Uint8Array): string | undefined {
  const header = readGeoPackageHeader(head);
  if (!header || header.extended || head.length < header.start + 5) return undefined;
  const little = head[header.start] === 1;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  try {
    const type = wkbType(view.getUint32(header.start + 1, little));
    const dimensions = `${type.z ? 'Z' : ''}${type.m ? 'M' : ''}`;
    return [type.name, dimensions, header.empty ? 'EMPTY' : ''].filter(Boolean).join(' ');
  } catch {
    return undefined;
  }
}

/** Every position of a geometry, in order. */
export function* positions(geometry: Geometry): Generator<Position> {
  switch (geometry.kind) {
    case 'point':
      if (geometry.point) yield geometry.point;
      return;
    case 'line':
      yield* geometry.points;
      return;
    case 'polygon':
      for (const ring of geometry.rings) yield* ring;
      return;
    case 'parts':
      for (const part of geometry.parts) yield* positions(part);
  }
}

/** The smallest box around a geometry's positions: minX, minY, maxX, maxY; null when empty. */
export function geometryBounds(geometry: Geometry): [number, number, number, number] | null {
  let bounds: [number, number, number, number] | null = null;
  for (const [x, y] of positions(geometry)) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!bounds) bounds = [x, y, x, y];
    else {
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
    }
  }
  return bounds;
}

/**
 * Whether a part goes without its name in WKT: the parts of multi-geometries, and the straight
 * lines among curves, do; those of a collection, and curved ones, say what they are.
 */
function plainPart(parent: GeometryName, part: GeometryName): boolean {
  switch (parent) {
    case 'MULTIPOINT':
    case 'MULTILINESTRING':
    case 'MULTIPOLYGON':
      return true;
    case 'COMPOUNDCURVE':
    case 'CURVEPOLYGON':
    case 'MULTICURVE':
      return part === 'LINESTRING';
    case 'MULTISURFACE':
      return part === 'POLYGON';
    default:
      return false;
  }
}

/** A geometry as Well-Known Text, stopping once it passes `limit` characters. */
export function toWkt(geometry: Geometry, limit = Infinity): { text: string; cut: boolean } {
  const out: string[] = [];
  let size = 0;
  let cut = false;
  const write = (text: string) => {
    if (size > limit) {
      cut = true;
      return;
    }
    out.push(text);
    size += text.length;
  };
  const position = (p: Position) => p.map((n) => String(n)).join(' ');
  const list = (points: Position[]) => {
    write('(');
    points.forEach((p, i) => write(i === 0 ? position(p) : `, ${position(p)}`));
    write(')');
  };
  const body = (g: Geometry, tagged: boolean) => {
    if (tagged) write(`${g.name}${g.dimensions ? ` ${g.dimensions}` : ''} `);
    switch (g.kind) {
      case 'point':
        if (g.point) write(`(${position(g.point)})`);
        else write('EMPTY');
        return;
      case 'line':
        if (g.points.length === 0) write('EMPTY');
        else list(g.points);
        return;
      case 'polygon':
        if (g.rings.length === 0) {
          write('EMPTY');
          return;
        }
        write('(');
        g.rings.forEach((ring, i) => {
          if (i > 0) write(', ');
          list(ring);
        });
        write(')');
        return;
      case 'parts': {
        if (g.parts.length === 0) {
          write('EMPTY');
          return;
        }
        write('(');
        g.parts.forEach((part, i) => {
          if (i > 0) write(', ');
          body(part, !plainPart(g.name, part.name));
        });
        write(')');
      }
    }
  };
  body(geometry, true);
  return { text: out.join(''), cut };
}
