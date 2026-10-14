import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  GeometryFormatError,
  geometryBounds,
  geometryLabel,
  readGeoPackageGeometry,
  readGeoPackageHeader,
  toWkt,
} from '../../src/shared/geometry';

/** Little-endian bytes for WKB: a byte order and type, then counts and coordinates. */
class Wkb {
  private readonly parts: Buffer[] = [];

  geometry(type: number): this {
    const head = Buffer.alloc(5);
    head[0] = 1;
    head.writeUInt32LE(type, 1);
    this.parts.push(head);
    return this;
  }

  count(n: number): this {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    this.parts.push(b);
    return this;
  }

  points(...values: number[]): this {
    const b = Buffer.alloc(values.length * 8);
    values.forEach((v, i) => b.writeDoubleLE(v, i * 8));
    this.parts.push(b);
    return this;
  }

  bytes(): Buffer {
    return Buffer.concat(this.parts);
  }
}

/** A GeoPackage geometry: the header, with an XY envelope when given one, then the WKB. */
function geoPackage(wkb: Buffer, srsId = 4326, envelope?: number[], empty = false): Uint8Array {
  const header = Buffer.alloc(8 + (envelope ? 32 : 0));
  header.write('GP', 0, 'ascii');
  header[2] = 0;
  header[3] = 1 | (envelope ? 1 << 1 : 0) | (empty ? 1 << 4 : 0);
  header.writeInt32LE(srsId, 4);
  envelope?.forEach((v, i) => header.writeDoubleLE(v, 8 + i * 8));
  return new Uint8Array(Buffer.concat([header, wkb]));
}

const wkt = (bytes: Uint8Array) => {
  const read = readGeoPackageGeometry(bytes);
  return read && toWkt(read.geometry).text;
};

describe('readGeoPackageHeader', () => {
  it('reads the SRS and the envelope, in either byte order', () => {
    const header = readGeoPackageHeader(
      geoPackage(new Wkb().geometry(1).points(1, 2).bytes(), 3857, [1, 3, 2, 4]),
    );
    expect(header).toEqual({
      srsId: 3857,
      envelope: [1, 3, 2, 4],
      empty: false,
      extended: false,
      start: 40,
    });
    const big = Buffer.from('4750000000000f34', 'hex');
    expect(readGeoPackageHeader(new Uint8Array(big))?.srsId).toBe(3892);
    expect(readGeoPackageHeader(new Uint8Array(Buffer.from('89504e47', 'hex')))).toBeUndefined();
  });
});

describe('readGeoPackageGeometry and toWkt', () => {
  it('reads every simple geometry as WKT writes it', () => {
    expect(wkt(geoPackage(new Wkb().geometry(1).points(28.97, 41.01).bytes()))).toBe(
      'POINT (28.97 41.01)',
    );
    expect(wkt(geoPackage(new Wkb().geometry(1001).points(1, 2, 3).bytes()))).toBe(
      'POINT Z (1 2 3)',
    );
    expect(
      wkt(geoPackage(new Wkb().geometry(1).points(NaN, NaN).bytes(), 0, undefined, true)),
    ).toBe('POINT EMPTY');
    expect(wkt(geoPackage(new Wkb().geometry(2).count(2).points(0, 0, 1, 1).bytes()))).toBe(
      'LINESTRING (0 0, 1 1)',
    );
    expect(
      wkt(
        geoPackage(new Wkb().geometry(3).count(1).count(4).points(0, 0, 4, 0, 4, 4, 0, 0).bytes()),
      ),
    ).toBe('POLYGON ((0 0, 4 0, 4 4, 0 0))');
    const multipoint = new Wkb()
      .geometry(4)
      .count(2)
      .geometry(1)
      .points(1, 2)
      .geometry(1)
      .points(3, 4)
      .bytes();
    expect(wkt(geoPackage(multipoint))).toBe('MULTIPOINT ((1 2), (3 4))');
    const collection = new Wkb()
      .geometry(7)
      .count(2)
      .geometry(1)
      .points(1, 2)
      .geometry(2)
      .count(2)
      .points(0, 0, 5, 5)
      .bytes();
    expect(wkt(geoPackage(collection))).toBe(
      'GEOMETRYCOLLECTION (POINT (1 2), LINESTRING (0 0, 5 5))',
    );
  });

  it('reads EWKB flags and curves', () => {
    expect(wkt(geoPackage(new Wkb().geometry(0x80000001).points(1, 2, 3).bytes()))).toBe(
      'POINT Z (1 2 3)',
    );
    const compound = new Wkb()
      .geometry(9)
      .count(2)
      .geometry(2)
      .count(2)
      .points(0, 0, 1, 1)
      .geometry(8)
      .count(3)
      .points(1, 1, 2, 0, 3, 1)
      .bytes();
    expect(wkt(geoPackage(compound))).toBe(
      'COMPOUNDCURVE ((0 0, 1 1), CIRCULARSTRING (1 1, 2 0, 3 1))',
    );
  });

  it('turns down geometries cut short or with counts beyond their bytes', () => {
    const point = new Wkb().geometry(1).points(1, 2).bytes();
    expect(() => readGeoPackageGeometry(geoPackage(point.subarray(0, 12)))).toThrow(
      GeometryFormatError,
    );
    expect(() =>
      readGeoPackageGeometry(geoPackage(new Wkb().geometry(2).count(1e9).bytes())),
    ).toThrow(GeometryFormatError);
    expect(() => readGeoPackageGeometry(geoPackage(new Wkb().geometry(99).bytes()))).toThrow(
      /Unknown geometry type 99/,
    );
  });

  it('stops writing WKT past a limit', () => {
    const many = new Wkb()
      .geometry(2)
      .count(1000)
      .points(...Array(2000).fill(1.5))
      .bytes();
    const read = readGeoPackageGeometry(geoPackage(many));
    const { text, cut } = toWkt(read!.geometry, 100);
    expect(cut).toBe(true);
    expect(text.length).toBeLessThan(120);
  });
});

describe('geometryLabel and geometryBounds', () => {
  it('names a geometry from its first bytes alone', () => {
    const polygon = geoPackage(new Wkb().geometry(1006).count(0).bytes(), 4326, [26, 45, 36, 42]);
    expect(geometryLabel(polygon.subarray(0, 45))).toBe('MULTIPOLYGON Z');
    expect(geometryLabel(polygon.subarray(0, 40))).toBeUndefined();
  });

  it('bounds the positions', () => {
    const line = readGeoPackageGeometry(
      geoPackage(new Wkb().geometry(2).count(3).points(3, -1, 0, 4, 2, 2).bytes()),
    );
    expect(geometryBounds(line!.geometry)).toEqual([0, -1, 3, 4]);
  });
});

describe('the GeoPackages of the corpus', () => {
  const files = ['example.gpkg', 'gdal_sample.gpkg', 'rivers.gpkg', 'countries_0.gpkg'].filter(
    (name) => existsSync(`test/corpus/${name}`),
  );

  it.skipIf(files.length === 0)('reads every geometry, inside its envelope', () => {
    let read = 0;
    for (const name of files) {
      const db = new DatabaseSync(`test/corpus/${name}`, { readOnly: true });
      try {
        const columns = db
          .prepare('SELECT table_name, column_name FROM gpkg_geometry_columns')
          .all() as { table_name: string; column_name: string }[];
        for (const { table_name, column_name } of columns) {
          const rows = db.prepare(`SELECT "${column_name}" AS g FROM "${table_name}"`).all() as {
            g: Uint8Array | null;
          }[];
          for (const { g } of rows) {
            if (!g) continue;
            const geometry = readGeoPackageGeometry(g);
            if (!geometry) continue;
            read++;
            const bounds = geometryBounds(geometry.geometry);
            const envelope = geometry.header.envelope;
            if (bounds && envelope) {
              expect(bounds[0]).toBeGreaterThanOrEqual(envelope[0] - 1e-6);
              expect(bounds[2]).toBeLessThanOrEqual(envelope[1] + 1e-6);
            }
            expect(toWkt(geometry.geometry, 1000).text).toMatch(/^[A-Z]+/);
          }
        }
      } finally {
        db.close();
      }
    }
    expect(read).toBeGreaterThan(100);
  });
});
