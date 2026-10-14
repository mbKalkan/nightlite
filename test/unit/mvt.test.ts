import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { readTile } from '../../src/extension/database/tiles';
import {
  TileFormatError,
  decodeTile,
  featureGeometry,
  featureProperties,
  valueText,
} from '../../src/shared/mvt';

// Just enough of a protobuf writer to build tiles by hand.
const varint = (value: number | bigint): number[] => {
  let n = BigInt(value);
  const out: number[] = [];
  while (n > 0x7fn) {
    out.push(Number(n & 0x7fn) | 0x80);
    n >>= 7n;
  }
  out.push(Number(n));
  return out;
};
const key = (field: number, wireType: number) => varint(field * 8 + wireType);
const message = (field: number, bytes: number[]) => [
  ...key(field, 2),
  ...varint(bytes.length),
  ...bytes,
];
const text = (field: number, value: string) => message(field, [...new TextEncoder().encode(value)]);
const number = (field: number, value: number | bigint) => [...key(field, 0), ...varint(value)];
const fixed = (field: number, bytes: number) => {
  const buffer = new DataView(new ArrayBuffer(bytes));
  if (bytes === 4) buffer.setFloat32(0, 1.5, true);
  else buffer.setFloat64(0, 0.1, true);
  return [...key(field, bytes === 4 ? 5 : 1), ...new Uint8Array(buffer.buffer)];
};
const zigzag = (n: number) => (n < 0 ? -2 * n - 1 : 2 * n);
const tile = (...layers: number[][]) =>
  new Uint8Array(layers.flatMap((layer) => message(3, layer)));

describe('decodeTile', () => {
  it('reads the layers, features and attributes of a real tile', () => {
    const db = new DatabaseSync('test/fixtures/sample.mbtiles', { readOnly: true });
    const content = readTile(db, 1, 1, 0);
    db.close();
    const layers = decodeTile(content?.data as Uint8Array);
    expect(layers.map((layer) => layer.name)).toEqual(['places', 'roads', 'water']);
    expect(layers.map((layer) => [layer.version, layer.extent])).toEqual([
      [2, 4096],
      [2, 4096],
      [2, 4096],
    ]);
    const [places, roads, water] = layers;
    expect(places.features.map((feature) => [feature.id, feature.type])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(featureProperties(places, places.features[1])).toEqual([
      ['name', { type: 'string', value: 'Köprübaşı' }],
      ['population', { type: 'sint', value: 2500 }],
      ['capital', { type: 'bool', value: false }],
    ]);
    expect(featureGeometry(places.features[1])).toHaveLength(1);
    const [line] = featureGeometry(roads.features[0]);
    expect(line).toHaveLength(6);
    expect(line.slice(2)).toEqual([2048, 1800, 4096, 2300]);
    const [ring] = featureGeometry(water.features[0]);
    // A closed ring ends where it began.
    expect(ring.slice(-2)).toEqual(ring.slice(0, 2));
    expect(ring).toHaveLength(10);
  });

  it('keeps every value type, 64-bit integers to the last digit', () => {
    const values = [
      text(1, 'text'),
      fixed(2, 4),
      fixed(3, 8),
      number(4, BigInt.asUintN(64, -42n)),
      number(5, 2n ** 64n - 1n),
      number(6, zigzag(-5)),
      number(7, 1),
    ];
    const layer = [
      ...text(1, 'values'),
      ...message(2, [
        ...number(1, 2n ** 60n),
        ...message(2, [0, 0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6]),
      ]),
      ...text(3, 'k'),
      ...values.flatMap((value) => message(4, value)),
    ];
    const [decoded] = decodeTile(tile(layer));
    expect(decoded.features[0].id).toBe('1152921504606846976');
    expect(featureProperties(decoded, decoded.features[0]).map(([, value]) => value)).toEqual([
      { type: 'string', value: 'text' },
      { type: 'float', value: 1.5 },
      { type: 'double', value: 0.1 },
      { type: 'int', value: -42 },
      { type: 'uint', value: '18446744073709551615' },
      { type: 'sint', value: -5 },
      { type: 'bool', value: true },
    ]);
  });

  it('reads lists given one number at a time or in parts', () => {
    const moveTo = [9, zigzag(10), zigzag(20)];
    const feature = [
      ...number(3, 1),
      ...moveTo.flatMap((n) => number(4, n)),
      ...number(2, 0),
      ...message(2, [0]),
    ];
    const [layer] = decodeTile(
      tile([
        ...text(1, 'points'),
        ...message(2, feature),
        ...text(3, 'a'),
        ...message(4, number(7, 0)),
      ]),
    );
    expect(featureGeometry(layer.features[0])).toEqual([[10, 20]]);
    expect(featureProperties(layer, layer.features[0])).toEqual([
      ['a', { type: 'bool', value: false }],
    ]);
  });

  it('keeps layers that share a name, and skips fields it does not know', () => {
    const layer = [...text(1, 'same'), ...number(99, 7), ...fixed(98, 4), ...fixed(97, 8)];
    const layers = decodeTile(
      new Uint8Array([...message(3, layer), ...message(3, layer), ...number(20, 1)]),
    );
    expect(layers.map((one) => one.name)).toEqual(['same', 'same']);
    expect(decodeTile(new Uint8Array())).toEqual([]);
  });

  it('turns damaged tiles down with a reason', () => {
    const whole = tile([...text(1, 'water'), ...number(5, 4096)]);
    expect(() => decodeTile(whole.subarray(0, whole.length - 3))).toThrow(TileFormatError);
    expect(() => decodeTile(new Uint8Array([0x1a, 0x7f, 0x01]))).toThrow('runs past the end');
    expect(() => decodeTile(new Uint8Array([...key(3, 3)]))).toThrow('Unknown field type 3');
    expect(() => decodeTile(new Uint8Array(11).fill(0xff))).toThrow('longer than ten bytes');
  });

  it('turns damaged geometry down when it is drawn', () => {
    const feature = (commands: number[]) =>
      decodeTile(
        tile([...text(1, 'l'), ...message(2, [...number(3, 2), ...message(4, commands)])]),
      )[0].features[0];
    expect(() => featureGeometry(feature([9, 2]))).toThrow('ends early');
    expect(() => featureGeometry(feature([12, 2, 2]))).toThrow('Unknown geometry command 4');
    expect(featureGeometry(feature([9, 2, 2, 18, 2, 2, 4, 4]))).toEqual([[1, 1, 2, 2, 4, 4]]);
  });
});

describe('valueText', () => {
  it('writes 32-bit floats with as few digits as read back the same', () => {
    expect(valueText({ type: 'float', value: Math.fround(3.66) })).toBe('3.66');
    expect(valueText({ type: 'float', value: Math.fround(0.1) })).toBe('0.1');
    expect(valueText({ type: 'float', value: Math.fround(16777217) })).toBe('16777216');
    expect(valueText({ type: 'float', value: Number.NaN })).toBe('NaN');
  });

  it('writes other values as they are', () => {
    expect(valueText({ type: 'double', value: 3.6600000858306885 })).toBe('3.6600000858306885');
    expect(valueText({ type: 'uint', value: '18446744073709551615' })).toBe('18446744073709551615');
    expect(valueText({ type: 'bool', value: false })).toBe('false');
    expect(valueText({ type: 'string', value: '' })).toBe('');
  });
});
