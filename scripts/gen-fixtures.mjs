// Writes the sample files in test/fixtures. Run with `npm run fixtures` after changing it and
// commit the results. Uses Node's built-in SQLite, so no native module is needed.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const FIXTURES = 'test/fixtures';
mkdirSync(FIXTURES, { recursive: true });

/** Creates a database from scratch, so reruns give the same tables. */
function create(name, build) {
  const path = join(FIXTURES, name);
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  try {
    build(db);
  } finally {
    db.close();
  }
  console.log(`wrote ${path}`);
}

create('sample.sqlite', (db) => {
  db.exec(`
    PRAGMA user_version = 7;
    CREATE TABLE artists (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO artists (name) VALUES ('Nina Simone'), ('Barış Manço'), ('Sezen Aksu');
  `);
});

// MBTiles 1.3: a metadata table and a tiles table, here with a single empty-ish tile.
create('sample.mbtiles', (db) => {
  db.exec(`
    PRAGMA application_id = 0x4d504258;
    CREATE TABLE metadata (name TEXT, value TEXT);
    CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
    CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
  `);
  const insert = db.prepare('INSERT INTO metadata (name, value) VALUES (?, ?)');
  for (const [name, value] of [
    ['name', 'Sample tiles'],
    ['format', 'pbf'],
    ['minzoom', '0'],
    ['maxzoom', '0'],
    ['bounds', '-180,-85.05112878,180,85.05112878'],
  ]) {
    insert.run(name, value);
  }
  db.prepare('INSERT INTO tiles VALUES (0, 0, 0, ?)').run(new Uint8Array([0x1a, 0x00]));
});

// GeoPackage declares itself with application_id 'GPKG' and user_version 10300 (1.3).
create('sample.gpkg', (db) => {
  db.exec(`
    PRAGMA application_id = 0x47504b47;
    PRAGMA user_version = 10300;
    CREATE TABLE gpkg_contents (table_name TEXT PRIMARY KEY, data_type TEXT NOT NULL);
  `);
});

writeFileSync(join(FIXTURES, 'empty.sqlite'), '');
writeFileSync(join(FIXTURES, 'not-sqlite.sqlite'), 'This is a text file, not a database.\n');
console.log('wrote empty.sqlite and not-sqlite.sqlite');
