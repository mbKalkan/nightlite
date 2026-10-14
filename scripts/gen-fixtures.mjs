// Writes the sample files in test/fixtures. Run with `npm run fixtures` after changing it and
// commit the results; `npm run fixtures:large` also writes big files for performance checks into
// test/fixtures/generated, which git ignores. Uses Node's built-in SQLite, so no native module.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { crc32, deflateSync, gzipSync } from 'node:zlib';

const FIXTURES = 'test/fixtures';
const GENERATED = join(FIXTURES, 'generated');
const large = process.argv.includes('--large');

mkdirSync(FIXTURES, { recursive: true });

/** Creates a database from scratch, so reruns give the same file. */
function create(path, build, options = {}) {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    rmSync(path + suffix, { force: true });
  }
  const db = new DatabaseSync(path, options);
  try {
    build(db);
  } finally {
    db.close();
  }
  console.log(`wrote ${path}`);
}

/** A repeatable stream of pseudo-random numbers in [0, 1). */
function random(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

// PNG ----------------------------------------------------------------------------------------

/** An RGB PNG; `pixel(x, y)` returns [r, g, b]. */
function png(width, height, pixel) {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const start = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      rows.set(pixel(x, y), start + 1 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Mapbox Vector Tiles (protobuf), https://github.com/mapbox/vector-tile-spec -----------------

const varint = (value) => {
  const out = [];
  let n = value;
  while (n > 0x7f) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const zigzag = (n) => (n << 1) ^ (n >> 31);
const key = (field, wireType) => varint(field * 8 + wireType);
const message = (field, bytes) => [...key(field, 2), ...varint(bytes.length), ...bytes];
const text = (field, value) => message(field, [...Buffer.from(value, 'utf8')]);
const packed = (field, values) => message(field, values.flatMap(varint));
const command = (id, count) => (id & 0x7) | (count << 3);

/** Geometry commands for a point, a line or a closed ring, from absolute tile coordinates. */
function geometry(type, points) {
  const out = [];
  let [cx, cy] = [0, 0];
  const delta = ([x, y]) => {
    const step = [zigzag(x - cx), zigzag(y - cy)];
    [cx, cy] = [x, y];
    return step;
  };
  out.push(command(1, 1), ...delta(points[0]));
  if (type !== 1) {
    out.push(command(2, points.length - 1), ...points.slice(1).flatMap(delta));
  }
  if (type === 3) {
    out.push(command(7, 1));
  }
  return out;
}

/** A Value message: strings, booleans, integers (as sint) and doubles. */
function value(v) {
  if (typeof v === 'string') {
    return text(1, v);
  }
  if (typeof v === 'boolean') {
    return [...key(7, 0), v ? 1 : 0];
  }
  if (Number.isInteger(v)) {
    return [...key(6, 0), ...varint(zigzag(v))];
  }
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleLE(v);
  return [...key(3, 1), ...bytes];
}

/** One layer: features are { id, type, points, properties }. */
function layer(name, features) {
  const keys = [];
  const values = [];
  const index = (list, item) => {
    const found = list.indexOf(item);
    return found >= 0 ? found : list.push(item) - 1;
  };
  const encoded = features.map((feature) => {
    const tags = Object.entries(feature.properties).flatMap(([k, v]) => [
      index(keys, k),
      index(values, v),
    ]);
    return message(2, [
      ...key(1, 0),
      ...varint(feature.id),
      ...packed(2, tags),
      ...key(3, 0),
      ...varint(feature.type),
      ...packed(4, geometry(feature.type, feature.points)),
    ]);
  });
  return message(3, [
    ...key(15, 0),
    2,
    ...text(1, name),
    ...encoded.flat(),
    ...keys.flatMap((k) => text(3, k)),
    ...values.flatMap((v) => message(4, value(v))),
    ...key(5, 0),
    ...varint(4096),
  ]);
}

/** A small vector tile whose features depend on where the tile is. */
function vectorTile(z, x, y) {
  const shift = (x * 37 + y * 53 + z * 11) % 900;
  return gzipSync(
    Buffer.from([
      ...layer('places', [
        {
          id: 1,
          type: 1,
          points: [[1000 + shift, 1200]],
          properties: {
            name: `Place ${z}/${x}/${y}`,
            population: 1000 * (z + 1),
            capital: z === 0,
          },
        },
        {
          id: 2,
          type: 1,
          points: [[2600, 3000 - shift]],
          properties: { name: 'Köprübaşı', population: 2500, capital: false },
        },
      ]),
      ...layer('roads', [
        {
          id: 10,
          type: 2,
          points: [
            [0, 2048 + shift],
            [2048, 1800],
            [4096, 2300],
          ],
          properties: { class: 'primary', lanes: 2 },
        },
      ]),
      ...layer('water', [
        {
          id: 20,
          type: 3,
          points: [
            [300, 300],
            [1500 + shift, 300],
            [1500, 1400],
            [300, 1400],
          ],
          properties: { kind: 'lake', area: 1.5 },
        },
      ]),
    ]),
    { level: 9 },
  );
}

/** TMS rows count from the bottom; tiles are named by XYZ rows elsewhere. */
const tmsRow = (z, y) => 2 ** z - 1 - y;

function eachTile(minZoom, maxZoom, visit) {
  for (let z = minZoom; z <= maxZoom; z++) {
    for (let x = 0; x < 2 ** z; x++) {
      for (let y = 0; y < 2 ** z; y++) {
        visit(z, x, y);
      }
    }
  }
}

const MBTILES_SCHEMA = `
  CREATE TABLE metadata (name TEXT, value TEXT);
  CREATE UNIQUE INDEX name ON metadata (name);
  CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
  CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
`;

function insertMetadata(db, entries) {
  const insert = db.prepare('INSERT INTO metadata (name, value) VALUES (?, ?)');
  for (const [name, value] of entries) {
    insert.run(name, value);
  }
}

// Databases ------------------------------------------------------------------------------------

const cover = png(8, 8, (x, y) => ((x + y) % 2 ? [24, 33, 43] : [240, 200, 80]));

create(join(FIXTURES, 'sample.sqlite'), (db) => {
  db.exec(`
    PRAGMA user_version = 7;
    CREATE TABLE artists (id INTEGER PRIMARY KEY, name TEXT NOT NULL, country TEXT, born INTEGER);
    CREATE TABLE albums (
      id INTEGER PRIMARY KEY,
      artist_id INTEGER NOT NULL REFERENCES artists (id),
      title TEXT NOT NULL,
      released TEXT,
      price REAL,
      cover BLOB,
      details TEXT,
      rating INTEGER DEFAULT 0 CHECK (rating BETWEEN 0 AND 5)
    );
    CREATE INDEX albums_by_artist ON albums (artist_id);
    CREATE VIEW album_list AS
      SELECT albums.title, artists.name AS artist, albums.released
      FROM albums JOIN artists ON artists.id = albums.artist_id;
    CREATE TRIGGER albums_unrated AFTER INSERT ON albums WHEN NEW.rating IS NULL
      BEGIN UPDATE albums SET rating = 0 WHERE id = NEW.id; END;
    CREATE TABLE tags (name TEXT PRIMARY KEY, color TEXT) WITHOUT ROWID;
    CREATE TABLE album_tags (
      album_id INTEGER REFERENCES albums (id),
      tag TEXT REFERENCES tags (name),
      PRIMARY KEY (album_id, tag)
    );
    CREATE TABLE "order items" ("order" INTEGER, "select" TEXT, "group" REAL);
    CREATE TABLE value_kinds (id INTEGER PRIMARY KEY, label TEXT, value);
    CREATE TABLE typed (id INTEGER PRIMARY KEY, amount REAL NOT NULL, note TEXT) STRICT;
    CREATE TABLE empty_table (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT, amount REAL);
    CREATE TABLE wide (id INTEGER PRIMARY KEY, ${Array.from({ length: 40 }, (_, i) => `c${String(i + 1).padStart(2, '0')} TEXT`).join(', ')});
  `);

  const artist = db.prepare('INSERT INTO artists (name, country, born) VALUES (?, ?, ?)');
  for (const row of [
    ['Nina Simone', 'US', 1933],
    ['Barış Manço', 'TR', 1943],
    ['Sezen Aksu', 'TR', 1954],
    ['Miles Davis', 'US', 1926],
    ['Björk', 'IS', 1965],
    ['Unknown artist', null, null],
  ]) {
    artist.run(...row);
  }

  const album = db.prepare(
    'INSERT INTO albums (artist_id, title, released, price, cover, details, rating) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  album.run(1, 'Pastel Blues', '1965-10-01', 9.99, cover, '{"format":"LP","tracks":9}', 5);
  album.run(
    2,
    '2023',
    '1975-01-01',
    12.5,
    null,
    '{"format":"LP","tracks":10,"labels":["Yavuz","Türküola"]}',
    4,
  );
  album.run(
    3,
    'Gülümse',
    '1991-06-01',
    7.25,
    cover,
    '{"format":"CD","tracks":11,"remastered":true}',
    null,
  );
  album.run(
    4,
    'Kind of Blue',
    '1959-08-17',
    14,
    cover,
    '{"format":"LP","tracks":5,"personnel":{"sax":["Coltrane","Adderley"]}}',
    5,
  );
  album.run(5, 'Homogenic', '1997-09-22', null, null, 'not json at all', 3);

  const tag = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)');
  for (const row of [
    ['jazz', '#3794ff'],
    ['pop', '#d18616'],
    ['anadolu rock', '#89d185'],
  ]) {
    tag.run(...row);
  }
  const albumTag = db.prepare('INSERT INTO album_tags VALUES (?, ?)');
  for (const row of [
    [1, 'jazz'],
    [2, 'anadolu rock'],
    [3, 'pop'],
    [4, 'jazz'],
  ]) {
    albumTag.run(...row);
  }

  db.prepare('INSERT INTO "order items" VALUES (?, ?, ?)').run(1, 'first', 0.5);

  // One row per kind of value a cell can hold.
  const kind = db.prepare('INSERT INTO value_kinds (label, value) VALUES (?, ?)');
  for (const row of [
    // JavaScript numbers bind as REAL; BigInts bind as INTEGER.
    ['integer', 42n],
    ['negative integer', -7n],
    ['whole real', 42],
    ['integer beyond 2^53', 9007199254740993n],
    ['real', 3.14159],
    ['real 0.1', 0.1],
    ['huge real', 1e300],
    ['empty text', ''],
    ['text that looks like a number', '007'],
    ['multi-line text', 'first line\nsecond line\n\tindented'],
    ['Turkish and emoji', 'İstanbul ğüşıöç 🌙 gece'],
    ['long text', 'Lorem ipsum dolor sit amet. '.repeat(400)],
    ['JSON object', '{"a":1,"b":[true,null,"x"],"c":{"d":2.5}}'],
    ['JSON array', '[1,2,3]'],
    ['blob', new Uint8Array([0, 1, 2, 127, 128, 255])],
    ['empty blob', new Uint8Array(0)],
    ['PNG blob', cover],
    ['null', null],
  ]) {
    kind.run(...row);
  }

  db.prepare('INSERT INTO typed (amount, note) VALUES (?, ?)').run(
    1.5,
    'strict tables check types',
  );

  const next = random(42);
  const kinds = ['open', 'close', 'update', 'error'];
  const event = db.prepare('INSERT INTO events (at, kind, amount) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  for (let i = 0; i < 5000; i++) {
    const at = new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString();
    event.run(at, kinds[Math.floor(next() * kinds.length)], Math.round(next() * 100000) / 100);
  }
  db.exec('COMMIT');

  const wideRow = db.prepare(
    `INSERT INTO wide VALUES (?, ${Array.from({ length: 40 }, () => '?').join(', ')})`,
  );
  for (let r = 1; r <= 20; r++) {
    wideRow.run(r, ...Array.from({ length: 40 }, (_, c) => `r${r}c${c + 1}`));
  }
});

// A database in write-ahead log mode, closed cleanly so its -wal and -shm files are gone.
create(join(FIXTURES, 'wal.sqlite'), (db) => {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);
    INSERT INTO notes (body) VALUES ('written through a write-ahead log');
  `);
});

// A database with no tables at all.
create(join(FIXTURES, 'no-tables.sqlite'), (db) => {
  db.exec('PRAGMA user_version = 1');
});

// A sound header and schema, but the table pages after them are overwritten.
create(join(FIXTURES, 'corrupt.sqlite'), (db) => {
  db.exec(`
    CREATE TABLE readings (id INTEGER PRIMARY KEY, value REAL);
    INSERT INTO readings (value) VALUES (1.5), (2.5), (3.5);
  `);
});
{
  const path = join(FIXTURES, 'corrupt.sqlite');
  const bytes = readFileSync(path);
  bytes.fill(0xab, 4096);
  writeFileSync(path, bytes);
}

// Vector tiles: metadata as tippecanoe and planetiler write it, zoom 0–2.
create(join(FIXTURES, 'sample.mbtiles'), (db) => {
  db.exec(`PRAGMA application_id = 0x4d504258; ${MBTILES_SCHEMA}`);
  insertMetadata(db, [
    ['name', 'Sample tiles'],
    ['description', 'Places, roads and water for tests'],
    ['format', 'pbf'],
    ['type', 'overlay'],
    ['version', '1'],
    ['minzoom', '0'],
    ['maxzoom', '2'],
    ['bounds', '-180,-85.05112878,180,85.05112878'],
    ['center', '0,0,1'],
    ['attribution', 'Generated test data'],
    [
      'json',
      JSON.stringify({
        vector_layers: [
          {
            id: 'places',
            description: 'Named points',
            minzoom: 0,
            maxzoom: 2,
            fields: { name: 'String', population: 'Number', capital: 'Boolean' },
          },
          { id: 'roads', minzoom: 0, maxzoom: 2, fields: { class: 'String', lanes: 'Number' } },
          { id: 'water', minzoom: 0, maxzoom: 2, fields: { kind: 'String', area: 'Number' } },
        ],
      }),
    ],
  ]);
  const insert = db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)');
  eachTile(0, 2, (z, x, y) => insert.run(z, x, tmsRow(z, y), vectorTile(z, x, y)));
});

// Raster tiles, zoom 0–1, each tile a color with a darker frame.
create(join(FIXTURES, 'raster.mbtiles'), (db) => {
  db.exec(MBTILES_SCHEMA);
  insertMetadata(db, [
    ['name', 'Raster tiles'],
    ['format', 'png'],
    ['type', 'baselayer'],
    ['minzoom', '0'],
    ['maxzoom', '1'],
    ['bounds', '-180,-85.05112878,180,85.05112878'],
  ]);
  const insert = db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)');
  eachTile(0, 1, (z, x, y) => {
    const fill = [40 + x * 90, 90 + y * 70, 160 - z * 60];
    const frame = fill.map((c) => Math.round(c * 0.6));
    const tile = png(256, 256, (px, py) =>
      px < 4 || py < 4 || px > 251 || py > 251 ? frame : fill,
    );
    insert.run(z, x, tmsRow(z, y), tile);
  });
});

// The deduplicating layout some tools write: tiles is a view over map and images. Its metadata
// leaves keys out and claims zoom levels the data doesn't have.
create(join(FIXTURES, 'dedup.mbtiles'), (db) => {
  db.exec(`
    CREATE TABLE metadata (name TEXT, value TEXT);
    CREATE TABLE map (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_id TEXT);
    CREATE UNIQUE INDEX map_index ON map (zoom_level, tile_column, tile_row);
    CREATE TABLE images (tile_data BLOB, tile_id TEXT);
    CREATE UNIQUE INDEX images_id ON images (tile_id);
    CREATE VIEW tiles AS
      SELECT map.zoom_level, map.tile_column, map.tile_row, images.tile_data
      FROM map JOIN images ON images.tile_id = map.tile_id;
  `);
  insertMetadata(db, [
    ['name', 'Deduplicated tiles'],
    ['format', 'pbf'],
    ['maxzoom', '5'],
  ]);
  const image = db.prepare('INSERT INTO images VALUES (?, ?)');
  image.run(vectorTile(0, 0, 0), 'world');
  image.run(vectorTile(1, 0, 0), 'ocean');
  const map = db.prepare('INSERT INTO map VALUES (?, ?, ?, ?)');
  map.run(0, 0, 0, 'world');
  eachTile(1, 1, (z, x, y) => map.run(z, x, tmsRow(z, y), 'ocean'));
});

// A made-up town for the README's tile browser picture: streets, a river, parks, buildings and
// places, one zoom 14 tile and its eight neighbors, each drawn from its own seed.
function townTile(x, y) {
  const next = random(x * 7919 + y * 104729);
  const between = (low, high) => low + Math.round(next() * (high - low));
  const riverAt = (px) => 2700 + Math.round(320 * Math.sin((px + x * 4096) / 650));
  const inRiver = (py, px) => Math.abs(py - riverAt(px)) < 260;
  const streets = [];
  const avenues = [];
  for (let at = 350; at < 4096; at += 750) {
    const wobble = between(-60, 60);
    streets.push([
      [-64, at],
      [1400, at + wobble],
      [2800, at - wobble],
      [4160, at],
    ]);
    avenues.push([
      [at, -64],
      [at + wobble, 1400],
      [at - wobble, 2800],
      [at, 4160],
    ]);
  }
  const roads = [...streets, ...avenues].map((points, i) => ({
    id: i + 1,
    type: 2,
    points,
    properties: { class: i % 3 === 0 ? 'primary' : 'street', lanes: i % 3 === 0 ? 4 : 2 },
  }));
  roads.push({
    id: 99,
    type: 2,
    points: [
      [-64, 4000],
      [1800, 2200],
      [4160, 300],
    ],
    properties: { class: 'motorway', lanes: 6 },
  });
  const bank = (offset, from, to, step) => {
    const points = [];
    for (let px = from; step > 0 ? px <= to : px >= to; px += step) {
      points.push([px, riverAt(px) + offset]);
    }
    return points;
  };
  const water = [
    {
      id: 1,
      type: 3,
      points: [...bank(-180, -64, 4160, 128), ...bank(180, 4160, -64, -128)],
      properties: { kind: 'river', name: 'Akarsu' },
    },
  ];
  const parks = [];
  const buildings = [];
  let id = 1;
  for (let left = 350; left < 4096; left += 750) {
    for (let top = 350; top < 4096; top += 750) {
      const wet = [100, 375, 650].some((dx) =>
        [100, 375, 650].some((dy) => inRiver(top + dy, left + dx)),
      );
      if (next() < 0.15 && !wet) {
        parks.push({
          id: parks.length + 1,
          type: 3,
          points: [
            [left + 60, top + 60],
            [left + 690, top + 60],
            [left + 690, top + 690],
            [left + 60, top + 690],
          ],
          properties: { kind: 'park', name: `Park ${parks.length + 1}` },
        });
        continue;
      }
      // Three by three lots, a building on most of them.
      for (let lot = 0; lot < 9; lot++) {
        if (next() < 0.2) continue;
        const width = between(90, 170);
        const height = between(90, 170);
        const bx = left + 70 + (lot % 3) * 200 + between(0, 190 - width);
        const by = top + 70 + Math.floor(lot / 3) * 200 + between(0, 190 - height);
        if (inRiver(by + height / 2, bx + width / 2)) continue;
        buildings.push({
          id: id++,
          type: 3,
          points: [
            [bx, by],
            [bx + width, by],
            [bx + width, by + height],
            [bx, by + height],
          ],
          properties: { height: between(3, 40), levels: between(1, 12) },
        });
      }
    }
  }
  const names = ['Old Town', 'Harbor', 'Market', 'Station', 'University', 'Bridge'];
  const places = names.map((name, i) => ({
    id: i + 1,
    type: 1,
    points: [[between(300, 3800), between(300, 3800)]],
    properties: { name, rank: i + 1 },
  }));
  return gzipSync(
    Buffer.from([
      ...layer('water', water),
      ...layer('parks', parks),
      ...layer('buildings', buildings),
      ...layer('roads', roads),
      ...layer('places', places),
    ]),
    { level: 9 },
  );
}

create(join(FIXTURES, 'showcase.mbtiles'), (db) => {
  db.exec(`PRAGMA application_id = 0x4d504258; ${MBTILES_SCHEMA}`);
  insertMetadata(db, [
    ['name', 'Showcase town'],
    ['description', 'A made-up town for screenshots'],
    ['format', 'pbf'],
    ['minzoom', '14'],
    ['maxzoom', '14'],
    ['bounds', '28.95,41,29,41.03'],
    ['center', '28.9784,41.0082,14'],
    [
      'json',
      JSON.stringify({
        vector_layers: ['water', 'parks', 'buildings', 'roads', 'places'].map((id) => ({
          id,
          minzoom: 14,
          maxzoom: 14,
          fields: {},
        })),
      }),
    ],
  ]);
  const insert = db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)');
  // The center, 28.9784,41.0082, is in tile 14/9510/6142.
  for (let x = 9509; x <= 9511; x++) {
    for (let y = 6141; y <= 6143; y++) {
      insert.run(14, x, tmsRow(14, y), townTile(x, y));
    }
  }
});

// GeoPackage 1.3: features (points, polygons, a line), tiles and attributes. Geometries are
// GeoPackage binary: a header, with an envelope for all but points, then WKB.
create(
  join(FIXTURES, 'sample.gpkg'),
  (db) => {
    db.exec(`
    PRAGMA application_id = 0x47504b47;
    PRAGMA user_version = 10300;
    CREATE TABLE gpkg_spatial_ref_sys (
      srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, organization TEXT NOT NULL,
      organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT
    );
    CREATE TABLE gpkg_contents (
      table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE,
      description TEXT DEFAULT '', last_change DATETIME NOT NULL,
      min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER
    );
    CREATE TABLE gpkg_geometry_columns (
      table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL,
      srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL,
      CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name)
    );
    CREATE TABLE gpkg_tile_matrix_set (
      table_name TEXT NOT NULL PRIMARY KEY, srs_id INTEGER NOT NULL,
      min_x DOUBLE NOT NULL, min_y DOUBLE NOT NULL, max_x DOUBLE NOT NULL, max_y DOUBLE NOT NULL
    );
    CREATE TABLE gpkg_tile_matrix (
      table_name TEXT NOT NULL, zoom_level INTEGER NOT NULL, matrix_width INTEGER NOT NULL,
      matrix_height INTEGER NOT NULL, tile_width INTEGER NOT NULL, tile_height INTEGER NOT NULL,
      pixel_x_size DOUBLE NOT NULL, pixel_y_size DOUBLE NOT NULL,
      CONSTRAINT pk_ttm PRIMARY KEY (table_name, zoom_level)
    );
    CREATE TABLE gpkg_extensions (
      table_name TEXT, column_name TEXT, extension_name TEXT NOT NULL, definition TEXT NOT NULL,
      scope TEXT NOT NULL, CONSTRAINT ge_tce UNIQUE (table_name, column_name, extension_name)
    );
    CREATE TABLE cities (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom POINT, name TEXT, population INTEGER);
    CREATE TABLE regions (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom MULTIPOLYGON, name TEXT);
    CREATE TABLE routes (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom LINESTRING, name TEXT);
    CREATE TABLE basemap (
      id INTEGER PRIMARY KEY AUTOINCREMENT, zoom_level INTEGER NOT NULL, tile_column INTEGER NOT NULL,
      tile_row INTEGER NOT NULL, tile_data BLOB NOT NULL, UNIQUE (zoom_level, tile_column, tile_row)
    );
    CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT, body TEXT);
  `);
    const srs = db.prepare('INSERT INTO gpkg_spatial_ref_sys VALUES (?, ?, ?, ?, ?, ?)');
    srs.run('Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', null);
    srs.run('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', null);
    srs.run(
      'WGS 84 geodetic',
      4326,
      'EPSG',
      4326,
      'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]',
      null,
    );
    srs.run(
      'WGS 84 / Pseudo-Mercator',
      3857,
      'EPSG',
      3857,
      'PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Mercator_1SP"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1]]',
      null,
    );
    const contents = db.prepare('INSERT INTO gpkg_contents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const changed = '2026-01-01T00:00:00.000Z';
    contents.run('cities', 'features', 'Cities', 'Sample cities', changed, 26, 36, 45, 42, 4326);
    contents.run(
      'regions',
      'features',
      'Regions',
      'Two regions, one of them with a lake',
      changed,
      26,
      36,
      33,
      42,
      4326,
    );
    contents.run(
      'routes',
      'features',
      'Routes',
      '',
      changed,
      27.1428,
      38.4237,
      32.8597,
      41.0082,
      4326,
    );
    const half = 20037508.342789244;
    contents.run(
      'basemap',
      'tiles',
      'Base map',
      'A two-level tile pyramid',
      changed,
      -half,
      -half,
      half,
      half,
      3857,
    );
    contents.run(
      'notes',
      'attributes',
      'Notes',
      'Rows without a geometry',
      changed,
      null,
      null,
      null,
      null,
      null,
    );
    const columns = db.prepare('INSERT INTO gpkg_geometry_columns VALUES (?, ?, ?, ?, ?, ?)');
    columns.run('cities', 'geom', 'POINT', 4326, 0, 0);
    columns.run('regions', 'geom', 'MULTIPOLYGON', 4326, 0, 0);
    columns.run('routes', 'geom', 'LINESTRING', 4326, 0, 0);
    db.prepare(
      "INSERT INTO gpkg_extensions VALUES ('regions', 'geom', 'gpkg_rtree_index', 'http://www.geopackage.org/spec120/#extension_rtree', 'write-only')",
    ).run();

    db.prepare('INSERT INTO gpkg_tile_matrix_set VALUES (?, ?, ?, ?, ?, ?)').run(
      'basemap',
      3857,
      -half,
      -half,
      half,
      half,
    );
    const matrix = db.prepare('INSERT INTO gpkg_tile_matrix VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const tile = db.prepare(
      'INSERT INTO basemap (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
    );
    for (const zoom of [0, 1]) {
      const n = 2 ** zoom;
      const pixel = (2 * half) / (256 * n);
      matrix.run('basemap', zoom, n, n, 256, 256, pixel, pixel);
      for (let x = 0; x < n; x++) {
        for (let y = 0; y < n; y++) {
          tile.run(
            zoom,
            x,
            y,
            png(16, 16, (px, py) => [
              40 + 60 * x,
              80 + 60 * y,
              160 + 40 * zoom + ((px + py) % 2) * 20,
            ]),
          );
        }
      }
    }
    const note = db.prepare('INSERT INTO notes (topic, body) VALUES (?, ?)');
    note.run('Sources', 'Coordinates are rounded and for testing only.');
    note.run('Tiles', 'The base map is a plain color per tile.');

    const point = (x, y) => {
      const blob = Buffer.alloc(8 + 21);
      blob.write('GP', 0, 'ascii');
      blob[2] = 0; // version 1
      blob[3] = 0b00000001; // no envelope, little-endian
      blob.writeInt32LE(4326, 4);
      blob[8] = 1; // WKB little-endian
      blob.writeUInt32LE(1, 9); // Point
      blob.writeDoubleLE(x, 13);
      blob.writeDoubleLE(y, 21);
      return blob;
    };
    /** A geometry with an XY envelope; `wkb` is the WKB after the header. */
    const withEnvelope = (wkb, [minX, minY, maxX, maxY]) => {
      const header = Buffer.alloc(8 + 32);
      header.write('GP', 0, 'ascii');
      header[3] = 0b00000011; // XY envelope, little-endian
      header.writeInt32LE(4326, 4);
      [minX, maxX, minY, maxY].forEach((v, i) => header.writeDoubleLE(v, 8 + i * 8));
      return Buffer.concat([header, wkb]);
    };
    const wkbHead = (type) => {
      const b = Buffer.alloc(5);
      b[0] = 1;
      b.writeUInt32LE(type, 1);
      return b;
    };
    const count = (n) => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(n);
      return b;
    };
    const coordinates = (points) => {
      const b = Buffer.alloc(points.length * 16);
      points.forEach(([x, y], i) => {
        b.writeDoubleLE(x, i * 16);
        b.writeDoubleLE(y, i * 16 + 8);
      });
      return b;
    };
    const polygon = (rings) =>
      Buffer.concat([
        wkbHead(3),
        count(rings.length),
        ...rings.flatMap((r) => [count(r.length), coordinates(r)]),
      ]);
    const multipolygon = (polygons) =>
      Buffer.concat([wkbHead(6), count(polygons.length), ...polygons.map(polygon)]);
    const bounds = (points) => [
      Math.min(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
      Math.max(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])),
    ];
    const marmara = [
      [26, 40],
      [29.9, 39.9],
      [30.4, 41.2],
      [28, 42],
      [26, 41.6],
      [26, 40],
    ];
    const lake = [
      [29.2, 40.6],
      [29.6, 40.6],
      [29.6, 40.9],
      [29.2, 40.9],
      [29.2, 40.6],
    ];
    const aegean = [
      [26.2, 37],
      [29.5, 37.2],
      [30, 38.8],
      [26.8, 39.5],
      [26.2, 37],
    ];
    const island = [
      [26.1, 36.2],
      [27.2, 36.3],
      [27, 36.8],
      [26.1, 36.2],
    ];
    const region = db.prepare('INSERT INTO regions (geom, name) VALUES (?, ?)');
    region.run(withEnvelope(multipolygon([[marmara, lake]]), bounds(marmara)), 'Marmara');
    region.run(
      withEnvelope(multipolygon([[aegean], [island]]), bounds([...aegean, ...island])),
      'Aegean',
    );
    const route = [
      [28.9784, 41.0082],
      [32.8597, 39.9334],
      [27.1428, 38.4237],
    ];
    db.prepare('INSERT INTO routes (geom, name) VALUES (?, ?)').run(
      withEnvelope(
        Buffer.concat([wkbHead(2), count(route.length), coordinates(route)]),
        bounds(route),
      ),
      'İstanbul–Ankara–İzmir',
    );

    const city = db.prepare('INSERT INTO cities (geom, name, population) VALUES (?, ?, ?)');
    city.run(point(28.9784, 41.0082), 'İstanbul', 15655924);
    city.run(point(32.8597, 39.9334), 'Ankara', 5803482);
    city.run(point(27.1428, 38.4237), 'İzmir', 4479525);

    // GDAL adds this view to the GeoPackages it writes, with a double-quoted string in it.
    db.exec(`
    CREATE VIEW st_geometry_columns AS
      SELECT table_name, column_name, "ST_" || geometry_type_name AS geometry_type_name,
        g.srs_id, srs_name
      FROM gpkg_geometry_columns AS g JOIN gpkg_spatial_ref_sys AS s
      WHERE g.srs_id = s.srs_id;
  `);
  },
  { enableDoubleQuotedStringLiterals: true },
);

writeFileSync(join(FIXTURES, 'empty.sqlite'), '');
writeFileSync(join(FIXTURES, 'not-sqlite.sqlite'), 'This is a text file, not a database.\n');
console.log('wrote empty.sqlite and not-sqlite.sqlite');

for (const name of ['wal.sqlite-wal', 'wal.sqlite-shm']) {
  if (existsSync(join(FIXTURES, name))) {
    throw new Error(`${name} was left behind; the WAL fixture must be closed cleanly`);
  }
}

// Large files for performance checks --------------------------------------------------------------

if (large) {
  mkdirSync(GENERATED, { recursive: true });
  create(join(GENERATED, 'large.sqlite'), (db) => {
    const rows = 10_000_000;
    db.exec(`
      PRAGMA journal_mode = OFF;
      PRAGMA synchronous = OFF;
      CREATE TABLE measurements (id INTEGER PRIMARY KEY, sensor TEXT, at INTEGER, value REAL);
      BEGIN;
    `);
    const insert = db.prepare('INSERT INTO measurements (sensor, at, value) VALUES (?, ?, ?)');
    const next = random(7);
    for (let i = 0; i < rows; i++) {
      insert.run(`sensor-${i % 250}`, 1767225600 + i, Math.round(next() * 1e6) / 1000);
      if (i % 1_000_000 === 999_999) {
        console.log(`  ${(i + 1) / 1_000_000} M rows`);
      }
    }
    db.exec('COMMIT');
  });
}
