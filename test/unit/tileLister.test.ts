import { DatabaseSync } from 'node:sqlite';
import { deflateSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TILE_LIMIT,
  TileLister,
  readStoredTile,
  readTile,
} from '../../src/extension/database/tiles';

const ZOOM = 10;

/** Places of a sparse zoom level: 400 columns of 300 rows, a fifth of them left out. */
function places(): [number, number][] {
  const list: [number, number][] = [];
  for (let column = 0; column < 400; column++) {
    for (let row = 0; row < 300; row++) {
      if ((column * 31 + row * 17) % 5 !== 0) list.push([column, row]);
    }
  }
  return list;
}

function tileset(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
    CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
  `);
  const insert = db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)');
  db.exec('BEGIN');
  for (const [column, row] of places()) insert.run(ZOOM, column, row, new Uint8Array([1]));
  insert.run(3, 0, 0, new Uint8Array([1]));
  db.exec('COMMIT');
  return db;
}

describe('TileLister', () => {
  let db: DatabaseSync;
  const all = places();
  const total = all.length;
  const indexOf = (tile: [number, number]) =>
    all.findIndex(([c, r]) => c === tile[0] && r === tile[1]);

  beforeAll(() => {
    db = tileset();
  });
  afterAll(() => db.close());

  it('lists every tile once, in index order, page after page', () => {
    const lister = new TileLister(db, ZOOM);
    const listed: [number, number][] = [];
    for (let start = 0; start < total; start += 1000) {
      const page = lister.page(start, 1000, total);
      expect(page.start).toBe(start);
      listed.push(...page.tiles);
    }
    expect(listed).toEqual(all);
  });

  it('reads the last page exactly, counting back from the last tile', () => {
    const lister = new TileLister(db, ZOOM);
    const page = lister.page(total - 100, 100, total);
    expect(page.tiles).toEqual(all.slice(total - 100));
    expect(lister.page(total - 50, 100, total).end).toBe(true);
  });

  it('jumps far into the list, and the pages around the jump join without gaps', () => {
    const lister = new TileLister(db, ZOOM);
    const start = Math.floor(total / 2);
    const middle = lister.page(start, 100, total);
    const before = lister.page(start - 100, 100, total);
    const after = lister.page(start + 100, 100, total);
    const joined = [...before.tiles, ...middle.tiles, ...after.tiles];
    expect(joined).toHaveLength(300);
    // Each tile is the one the index has right after the tile before it.
    const first = indexOf(joined[0]);
    expect(first).toBeGreaterThan(0);
    expect(joined).toEqual(all.slice(first, first + 300));
    // The estimate lands near where the tiles really are.
    expect(Math.abs(first - (start - 100))).toBeLessThan(total / 20);
  });

  it('locates tiles near listed ones exactly', () => {
    const lister = new TileLister(db, ZOOM);
    lister.page(0, 300, total);
    const [column, row] = all[250];
    expect(lister.locate(column, row, total)).toBe(250);
    // A place with no tile is where the next tile is.
    const missing = [0, 0] as const;
    expect(indexOf([...missing])).toBe(-1);
    expect(lister.locate(missing[0], missing[1], total)).toBe(0);
    const gap = all.findIndex(([c, r], i) => i > 0 && c === all[i - 1][0] && r > all[i - 1][1] + 1);
    expect(lister.locate(all[gap][0], all[gap][1] - 1, total)).toBe(gap);
  });

  it('lists the page around a tile located far away, with the tile in it', () => {
    const lister = new TileLister(db, ZOOM);
    const target = all[Math.floor(total * 0.6)];
    const position = lister.locate(target[0], target[1], total);
    const start = Math.floor(position / 100) * 100;
    const page = lister.page(start, 100, total);
    expect(page.tiles[position - page.start]).toEqual(target);
    // And the neighbors of that page continue from it.
    const next = lister.page(start + 100, 100, total);
    const at = indexOf(page.tiles[0]);
    expect([...page.tiles, ...next.tiles]).toEqual(all.slice(at, at + 200));
  });

  it('places tiles past either end at the ends', () => {
    const lister = new TileLister(db, ZOOM);
    expect(lister.locate(500, 0, total)).toBe(total);
    expect(lister.locate(0, 1, total)).toBe(0);
  });

  it('lists a zoom level of one tile, and one with none', () => {
    expect(new TileLister(db, 3).page(0, 100, 1)).toEqual({ start: 0, tiles: [[0, 0]], end: true });
    expect(new TileLister(db, 4).page(0, 100, 0)).toEqual({ start: 0, tiles: [], end: true });
  });

  it('lists tiles that are a view over shared images', () => {
    const dedup = new DatabaseSync('test/fixtures/dedup.mbtiles', { readOnly: true });
    const page = new TileLister(dedup, 1).page(0, 10, 4);
    expect(page.tiles).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    dedup.close();
  });
});

describe('readTile', () => {
  let db: DatabaseSync;
  const vector = new Uint8Array([0x1a, 0x02, 0x78, 0x01]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  beforeAll(() => {
    db = new DatabaseSync(':memory:');
    db.exec(
      'CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)',
    );
    const insert = db.prepare('INSERT INTO tiles VALUES (0, ?, 0, ?)');
    insert.run(0, gzipSync(vector));
    insert.run(1, deflateSync(vector));
    insert.run(2, png);
    insert.run(3, null);
    insert.run(4, new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3]));
    insert.run(5, 'text');
    db.prepare(`INSERT INTO tiles VALUES (0, 6, 0, zeroblob(${TILE_LIMIT + 1}))`).run();
  });
  afterAll(() => db.close());

  it('uncompresses gzip and zlib tiles, and says how they were stored', () => {
    const gzip = readTile(db, 0, 0, 0);
    expect(gzip?.compression).toBe('gzip');
    expect(gzip?.data).toEqual(vector);
    expect(gzip?.size).toBe(gzipSync(vector).length);
    expect(readTile(db, 0, 1, 0)).toMatchObject({ compression: 'zlib', data: vector });
  });

  it('passes other tiles on as stored', () => {
    expect(readTile(db, 0, 2, 0)).toEqual({ size: 8, compression: null, data: png });
    expect(readTile(db, 0, 3, 0)).toEqual({ size: 0, compression: null, data: new Uint8Array() });
    expect(readTile(db, 0, 5, 0)?.data).toEqual(new TextEncoder().encode('text'));
  });

  it('says why a tile has no data to show', () => {
    expect(readTile(db, 0, 4, 0)).toMatchObject({
      compression: 'gzip',
      data: null,
      problem: 'damaged',
    });
    expect(readTile(db, 0, 6, 0)).toEqual({
      size: TILE_LIMIT + 1,
      compression: null,
      data: null,
      problem: 'tooLarge',
    });
  });

  it('answers null where there is no tile', () => {
    expect(readTile(db, 0, 9, 9)).toBeNull();
  });

  it('reads a tile as stored, whole, for saving', () => {
    expect(readStoredTile(db, 0, 0, 0)).toEqual(new Uint8Array(gzipSync(vector)));
    expect(readStoredTile(db, 0, 3, 0)).toEqual(new Uint8Array());
    expect(readStoredTile(db, 0, 5, 0)).toEqual(new TextEncoder().encode('text'));
    expect(readStoredTile(db, 0, 6, 0)).toHaveLength(TILE_LIMIT + 1);
    expect(readStoredTile(db, 0, 9, 9)).toBeNull();
  });
});
