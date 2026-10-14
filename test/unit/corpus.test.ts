// Opens every real-world file in test/corpus (`npm run corpus` fetches them) the way the viewer
// does and reads all of it a viewer would show. Skipped where the corpus hasn't been fetched,
// as in CI.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { readDetails } from '../../src/extension/database/details';
import { readMbtiles, zoomCount, zoomRange } from '../../src/extension/database/mbtiles';
import { TableReader } from '../../src/extension/database/rows';
import { readSchema } from '../../src/extension/database/schema';
import { READ_OPTIONS, connectionTarget } from '../../src/extension/database/target';
import { readTileset, zoomLevels } from '../../src/shared/mbtiles';
import { HEADER_SIZE, describeFile } from '../../src/shared/sqliteHeader';

const CORPUS = 'test/corpus';
const files = existsSync(CORPUS) ? readdirSync(CORPUS).sort() : [];

/** What can't be read in these files, and why: SQLite's own words, or the header's verdict. */
const EXPECTED: Record<string, string[]> = {};

/** Reads everything the viewer would show of one file; returns what failed, as `step: message`. */
function scan(file: string): string[] {
  const path = join(CORPUS, file);
  const failures: string[] = [];
  const attempt = (step: string, read: () => void) => {
    try {
      read();
    } catch (error) {
      failures.push(`${step}: ${(error as Error).message}`);
    }
  };
  const header = describeFile(
    path,
    readFileSync(path).subarray(0, HEADER_SIZE),
    statSync(path).size,
  );
  if ('error' in header) return [`header: ${header.error}`];
  const db = new DatabaseSync(connectionTarget(path, header.file.header.wal), READ_OPTIONS);
  try {
    let objects: ReturnType<typeof readSchema> = [];
    attempt('schema', () => (objects = readSchema(db)));
    for (const object of objects) {
      attempt(`details ${object.name}`, () => readDetails(db, object.name));
      if (object.type !== 'table' && object.type !== 'view') continue;
      attempt(`rows ${object.name}`, () => {
        const reader = new TableReader(db, object.name);
        const total = reader.info.estimate ?? 100;
        const first = reader.page(0, 100, total);
        if (total > 200) {
          reader.page(Math.floor(total / 2), 100, total);
          reader.page(Math.max(0, total - 100), 100, total);
        }
        if (first.rows.length > 0) {
          reader.copy({
            start: 0,
            count: 10,
            total,
            firstColumn: 0,
            lastColumn: reader.info.columns.length - 1,
          });
          reader.info.columns.forEach((_, column) =>
            reader.cell(0, total, column, first.rowids?.[0]),
          );
        }
        reader.count();
      });
    }
    if (header.file.format === 'mbtiles') {
      attempt('mbtiles', () => {
        const summary = readMbtiles(db);
        readTileset(summary.metadata ?? []);
        if (summary.tiles) {
          const range = zoomRange(db);
          for (const zoom of range ? zoomLevels(range) : []) zoomCount(db, zoom);
        }
      });
    }
  } finally {
    db.close();
  }
  return failures;
}

describe.skipIf(files.length === 0)('the real-world corpus', () => {
  for (const file of files) {
    it(`reads ${file}`, () => {
      expect(scan(file)).toEqual(EXPECTED[file] ?? []);
    });
  }
});
