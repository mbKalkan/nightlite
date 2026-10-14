// Guards the shapes other tests rely on, so regenerating the fixtures can't quietly change them.
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const open = (name: string) => new DatabaseSync(`test/fixtures/${name}`, { readOnly: true });

describe('test fixtures', () => {
  it('have a sample database with every kind of schema object and value', () => {
    const db = open('sample.sqlite');
    const objects = db
      .prepare("SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => `${row.type}:${row.name}`);
    expect(objects).toEqual(
      expect.arrayContaining([
        'table:artists',
        'table:albums',
        'table:tags',
        'table:order items',
        'table:value_kinds',
        'table:typed',
        'table:empty_table',
        'table:events',
        'table:wide',
        'view:album_list',
        'index:albums_by_artist',
        'trigger:albums_unrated',
      ]),
    );
    expect(db.prepare('SELECT count(*) AS n FROM events').get()?.n).toBe(5000);
    const big = db.prepare("SELECT value FROM value_kinds WHERE label = 'integer beyond 2^53'");
    big.setReadBigInts(true);
    expect(big.get()?.value).toBe(9007199254740993n);
    db.close();
  });

  it('keep the WAL fixture without its -wal and -shm files', () => {
    expect(existsSync('test/fixtures/wal.sqlite-wal')).toBe(false);
    expect(existsSync('test/fixtures/wal.sqlite-shm')).toBe(false);
  });

  it('have a database whose table pages are damaged', () => {
    const db = open('corrupt.sqlite');
    expect(() => db.prepare('SELECT * FROM readings').all()).toThrow(/malformed/);
    db.close();
  });

  it('have vector tiles with three layers, gzipped as MBTiles stores them', () => {
    const db = open('sample.mbtiles');
    const tiles = db.prepare('SELECT zoom_level AS z, count(*) AS n FROM tiles GROUP BY z').all();
    expect(tiles.map((row) => [row.z, row.n])).toEqual([
      [0, 1],
      [1, 4],
      [2, 16],
    ]);
    const tile = db.prepare('SELECT tile_data FROM tiles LIMIT 1').get()?.tile_data as Uint8Array;
    const data = gunzipSync(tile);
    for (const name of ['places', 'roads', 'water']) {
      expect(data.includes(Buffer.from(name))).toBe(true);
    }
    db.close();
  });

  it('have raster tiles as PNG images', () => {
    const db = open('raster.mbtiles');
    const tile = db.prepare('SELECT tile_data FROM tiles LIMIT 1').get()?.tile_data as Uint8Array;
    expect(Buffer.from(tile.subarray(1, 4)).toString('ascii')).toBe('PNG');
    db.close();
  });

  it('have deduplicated tiles behind a view, with metadata that overstates the zoom levels', () => {
    const db = open('dedup.mbtiles');
    expect(db.prepare("SELECT type FROM sqlite_schema WHERE name = 'tiles'").get()?.type).toBe(
      'view',
    );
    expect(db.prepare('SELECT max(zoom_level) AS z FROM tiles').get()?.z).toBe(1);
    expect(db.prepare("SELECT value FROM metadata WHERE name = 'maxzoom'").get()?.value).toBe('5');
    db.close();
  });

  it('have a GeoPackage with features, tiles and attributes', () => {
    const db = open('sample.gpkg');
    expect(db.prepare('SELECT table_name, data_type FROM gpkg_contents').all()).toEqual([
      { table_name: 'cities', data_type: 'features' },
      { table_name: 'regions', data_type: 'features' },
      { table_name: 'routes', data_type: 'features' },
      { table_name: 'basemap', data_type: 'tiles' },
      { table_name: 'notes', data_type: 'attributes' },
    ]);
    const geom = db.prepare('SELECT geom FROM cities LIMIT 1').get()?.geom as Uint8Array;
    expect(Buffer.from(geom.subarray(0, 2)).toString('ascii')).toBe('GP');
    db.close();
  });
});
