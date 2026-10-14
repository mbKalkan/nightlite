// Reads Mapbox Vector Tiles (https://github.com/mapbox/vector-tile-spec, version 2.1). The
// protobuf wire format is simple enough to read by hand, which keeps the tile exactly as stored:
// every layer, even two with one name, and 64-bit integers to the last digit. Tiles come from
// files of any origin, so every length is checked against the bytes there are (D-016).

export type GeometryType = 0 | 1 | 2 | 3;

export const GEOMETRY_NAMES = ['Unknown', 'Point', 'LineString', 'Polygon'] as const;

/** An attribute value with the type the tile gave it; 64-bit integers past 2^53 as text. */
export type TileValue =
  | { type: 'string'; value: string }
  | { type: 'float' | 'double'; value: number }
  | { type: 'int' | 'uint' | 'sint'; value: number | string }
  | { type: 'bool'; value: boolean };

/** Packed numbers as stored, read when needed; or read already, when the tile didn't pack them. */
type Numbers = Uint8Array | number[];

export interface TileFeature {
  id?: number | string;
  type: GeometryType;
  tags: Numbers;
  geometry: Numbers;
}

export interface TileLayer {
  name: string;
  version: number;
  /** The size of the tile's square in its own units, 4096 unless the layer says otherwise. */
  extent: number;
  keys: string[];
  values: TileValue[];
  features: TileFeature[];
}

export class TileFormatError extends Error {}

const utf8 = new TextDecoder('utf-8');

/** A protobuf reader over a part of the bytes, failing on anything that runs past its end. */
class Reader {
  pos: number;

  constructor(
    private readonly bytes: Uint8Array,
    start = 0,
    readonly end = bytes.length,
  ) {
    this.pos = start;
  }

  get done(): boolean {
    return this.pos >= this.end;
  }

  /** A varint as a number, exact up to 2^53. */
  varint(): number {
    let result = 0;
    let factor = 1;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new TileFormatError('A number runs past the end.');
      const byte = this.bytes[this.pos++];
      result += (byte & 0x7f) * factor;
      if (byte < 0x80) return result;
      factor *= 128;
    }
    throw new TileFormatError('A number is longer than ten bytes.');
  }

  /** A varint to the last bit, as 64 unsigned bits. */
  bigVarint(): bigint {
    let result = 0n;
    let shift = 0n;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new TileFormatError('A number runs past the end.');
      const byte = this.bytes[this.pos++];
      result |= BigInt(byte & 0x7f) << shift;
      if (byte < 0x80) return BigInt.asUintN(64, result);
      shift += 7n;
    }
    throw new TileFormatError('A number is longer than ten bytes.');
  }

  /** The bounds of a length-delimited field's contents, which the reader then skips. */
  span(): [number, number] {
    const length = this.varint();
    const start = this.pos;
    if (length > this.end - start) throw new TileFormatError('A field runs past the end.');
    this.pos += length;
    return [start, this.pos];
  }

  string(): string {
    const [start, end] = this.span();
    return utf8.decode(this.bytes.subarray(start, end));
  }

  fixed(size: 4 | 8): DataView {
    if (this.end - this.pos < size) throw new TileFormatError('A number runs past the end.');
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, size);
    this.pos += size;
    return view;
  }

  /**
   * Adds a list's numbers to those read so far. Packed numbers keep their bytes; a list given
   * in parts, or one number at a time, is read into an array.
   */
  numbers(wireType: number, into: Numbers): Numbers {
    if (wireType === 2) {
      const [start, end] = this.span();
      const packed = this.bytes.subarray(start, end);
      return into.length === 0 ? packed : [...unpack(into), ...unpack(packed)];
    }
    if (wireType !== 0) throw new TileFormatError('A list of numbers has the wrong type.');
    const list = unpack(into);
    list.push(this.varint());
    return list;
  }

  skip(wireType: number): void {
    switch (wireType) {
      case 0:
        this.varint();
        return;
      case 1:
        this.fixed(8);
        return;
      case 2:
        this.span();
        return;
      case 5:
        this.fixed(4);
        return;
      default:
        throw new TileFormatError(`Unknown field type ${wireType}.`);
    }
  }

  /** Calls `field` for each field of the message, with the reader on its value. */
  fields(field: (number: number, wireType: number) => void): void {
    while (!this.done) {
      const key = this.varint();
      const before = this.pos;
      field(Math.floor(key / 8), key % 8);
      if (this.pos === before) this.skip(key % 8);
    }
  }

  sub([start, end]: [number, number]): Reader {
    return new Reader(this.bytes, start, end);
  }
}

function unpack(numbers: Numbers): number[] {
  if (Array.isArray(numbers)) return numbers;
  const reader = new Reader(numbers);
  const list: number[] = [];
  while (!reader.done) list.push(reader.varint());
  return list;
}

/** Every layer of a vector tile, uncompressed. Features are read; their geometry when asked. */
export function decodeTile(bytes: Uint8Array): TileLayer[] {
  const layers: TileLayer[] = [];
  const tile = new Reader(bytes);
  tile.fields((number, wireType) => {
    if (number === 3 && wireType === 2) layers.push(readLayer(tile.sub(tile.span())));
  });
  return layers;
}

function readLayer(reader: Reader): TileLayer {
  const layer: TileLayer = {
    name: '',
    version: 1,
    extent: 4096,
    keys: [],
    values: [],
    features: [],
  };
  reader.fields((number, wireType) => {
    if (number === 15 && wireType === 0) layer.version = reader.varint();
    else if (number === 1 && wireType === 2) layer.name = reader.string();
    else if (number === 2 && wireType === 2)
      layer.features.push(readFeature(reader.sub(reader.span())));
    else if (number === 3 && wireType === 2) layer.keys.push(reader.string());
    else if (number === 4 && wireType === 2)
      layer.values.push(readValue(reader.sub(reader.span())));
    else if (number === 5 && wireType === 0) layer.extent = reader.varint();
  });
  return layer;
}

function readFeature(reader: Reader): TileFeature {
  const feature: TileFeature = { type: 0, tags: [], geometry: [] };
  reader.fields((number, wireType) => {
    if (number === 1 && wireType === 0) {
      const id = reader.bigVarint();
      feature.id = id <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(id) : id.toString();
    } else if (number === 2) {
      feature.tags = reader.numbers(wireType, feature.tags);
    } else if (number === 3 && wireType === 0) {
      const type = reader.varint();
      feature.type = type <= 3 ? (type as GeometryType) : 0;
    } else if (number === 4) {
      feature.geometry = reader.numbers(wireType, feature.geometry);
    }
  });
  return feature;
}

function readValue(reader: Reader): TileValue {
  let value: TileValue = { type: 'string', value: '' };
  const integer = (big: bigint, type: 'int' | 'uint' | 'sint'): TileValue => ({
    type,
    value:
      big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(big)
        : big.toString(),
  });
  reader.fields((number, wireType) => {
    if (number === 1 && wireType === 2) value = { type: 'string', value: reader.string() };
    else if (number === 2 && wireType === 5) {
      value = { type: 'float', value: reader.fixed(4).getFloat32(0, true) };
    } else if (number === 3 && wireType === 1) {
      value = { type: 'double', value: reader.fixed(8).getFloat64(0, true) };
    } else if (number === 4 && wireType === 0) {
      value = integer(BigInt.asIntN(64, reader.bigVarint()), 'int');
    } else if (number === 5 && wireType === 0) {
      value = integer(reader.bigVarint(), 'uint');
    } else if (number === 6 && wireType === 0) {
      const raw = reader.bigVarint();
      value = integer((raw >> 1n) ^ -(raw & 1n), 'sint');
    } else if (number === 7 && wireType === 0) {
      value = { type: 'bool', value: reader.varint() !== 0 };
    }
  });
  return value;
}

/** A feature's attributes in the order the tile lists them; tags pointing nowhere are left out. */
export function featureProperties(layer: TileLayer, feature: TileFeature): [string, TileValue][] {
  const tags = unpack(feature.tags);
  const properties: [string, TileValue][] = [];
  for (let i = 0; i + 1 < tags.length; i += 2) {
    const key = layer.keys[tags[i]];
    const value = layer.values[tags[i + 1]];
    if (key !== undefined && value !== undefined) properties.push([key, value]);
  }
  return properties;
}

/** Points the drawing gives up on a feature after: far more than a real tile has. */
const POINT_LIMIT = 4_000_000;

/**
 * A feature's geometry in tile units: one array of x, y pairs per part. Points come as one
 * part, lines one part per line, polygons one per ring, closed rings ending where they began.
 */
export function featureGeometry(feature: TileFeature): number[][] {
  const commands = unpack(feature.geometry);
  const parts: number[][] = [];
  let part: number[] | undefined;
  let x = 0;
  let y = 0;
  let points = 0;
  let i = 0;
  const zigzag = (n: number) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);
  while (i < commands.length) {
    const command = commands[i] & 0x7;
    const count = Math.floor(commands[i] / 8);
    i++;
    if (command === 7) {
      if (part && part.length >= 2) part.push(part[0], part[1]);
      continue;
    }
    if (command !== 1 && command !== 2) {
      throw new TileFormatError(`Unknown geometry command ${command}.`);
    }
    if (i + count * 2 > commands.length) throw new TileFormatError('A geometry ends early.');
    points += count;
    if (points > POINT_LIMIT) throw new TileFormatError('A geometry has too many points.');
    for (let n = 0; n < count; n++) {
      x += zigzag(commands[i++]);
      y += zigzag(commands[i++]);
      if (command === 1 && (feature.type !== 1 || !part)) {
        part = [];
        parts.push(part);
      }
      part?.push(x, y);
    }
  }
  return parts;
}
