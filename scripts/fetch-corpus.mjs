// Downloads real-world sample files into test/corpus, which git ignores: databases, tilesets
// and GeoPackages made by other tools, to open by hand; `npm test` then reads them all too.
// Every file comes from an openly licensed project; nothing here ships with the extension.
// Run with `npm run corpus`; files already there are kept.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CORPUS = 'test/corpus';

const CHINOOK = 'https://github.com/lerocha/chinook-database/releases/download/v1.4.5';
const NORTHWIND = 'https://raw.githubusercontent.com/jpwhite3/northwind-SQLite3/main/dist';
const SAKILA = 'https://raw.githubusercontent.com/bradleygrant/sakila-sqlite3/master';
const MBTILESERVER = 'https://raw.githubusercontent.com/consbio/mbtileserver/main/testdata';
const GEOPACKAGE_JS =
  'https://raw.githubusercontent.com/ngageoint/geopackage-js/master/test/fixtures';

/** [file name in the corpus, URL, where it comes from and its license] */
const FILES = [
  // SQLite databases: a music store, a trading company and a film rental shop.
  ['chinook.sqlite', `${CHINOOK}/Chinook_Sqlite.sqlite`, 'lerocha/chinook-database, MIT'],
  ['northwind.db', `${NORTHWIND}/northwind.db`, 'jpwhite3/northwind-SQLite3, MIT'],
  ['sakila.db', `${SAKILA}/sakila_master.db`, 'bradleygrant/sakila-sqlite3, BSD-3-Clause'],
  // MBTiles: raster tiles in three image formats, vector tiles, and broken or incomplete ones.
  ...[
    'geography-class-png.mbtiles',
    'geography-class-jpg.mbtiles',
    'geography-class-webp.mbtiles',
    'geography-class-png-no-bounds.mbtiles',
    'world_cities.mbtiles',
    'world_cities_missing_center.mbtiles',
    'invalid-tile-format.mbtiles',
    'invalid.mbtiles',
  ].map((name) => [name, `${MBTILESERVER}/${name}`, 'consbio/mbtileserver, ISC']),
  // GeoPackages: features, tiles, attributes and styles from the NGA GeoPackage libraries.
  ...[
    'example.gpkg',
    'gdal_sample.gpkg',
    'rivers.gpkg',
    'countries_0.gpkg',
    'denver_tile.gpkg',
    'attributes.gpkg',
    'styled.gpkg',
  ].map((name) => [name, `${GEOPACKAGE_JS}/${name}`, 'ngageoint/geopackage-js, MIT']),
];

mkdirSync(CORPUS, { recursive: true });
let failed = 0;
for (const [name, url, source] of FILES) {
  const path = join(CORPUS, name);
  if (existsSync(path)) {
    console.log(`kept    ${name}`);
    continue;
  }
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    writeFileSync(path, bytes);
    console.log(`fetched ${name} (${Math.round(bytes.length / 1024)} KB) from ${source}`);
  } catch (error) {
    failed++;
    console.error(`failed  ${name}: ${error.message}`);
  }
}
if (failed) process.exitCode = 1;
