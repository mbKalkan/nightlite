import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { readMetadataRows } from '../../src/extension/database/mbtiles';
import { writeMetadata } from '../../src/extension/database/metadataWrite';

const scratch = mkdtempSync(join(tmpdir(), 'nightlite-metadata-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let copies = 0;
/** A copy of a fixture in a folder of its own. */
function copyOf(fixture: string): string {
  const folder = join(scratch, String(++copies));
  mkdirSync(folder);
  const path = join(folder, fixture);
  copyFileSync(join('test/fixtures', fixture), path);
  return path;
}

function metadataOf(path: string): [string, string][] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return readMetadataRows(db).rows.map((row) => [row.name, row.value]);
  } finally {
    db.close();
  }
}

describe('writeMetadata', () => {
  it('sets, adds and removes keys in one go', () => {
    const path = copyOf('raster.mbtiles');
    writeMetadata(path, [
      ['name', 'Renamed'],
      ['center', '0,0,1'],
      ['type', null],
    ]);
    const after = new Map(metadataOf(path));
    expect(after.get('name')).toBe('Renamed');
    expect(after.get('center')).toBe('0,0,1');
    expect(after.has('type')).toBe(false);
    expect(after.get('format')).toBe('png');
  });

  it('writes a key once, however many times the file had it', () => {
    // This file's metadata has no unique index, as some tools write it.
    const path = copyOf('dedup.mbtiles');
    const db = new DatabaseSync(path);
    try {
      db.prepare("INSERT INTO metadata VALUES ('name', 'Again')").run();
    } finally {
      db.close();
    }
    expect(metadataOf(path).filter(([name]) => name === 'name')).toHaveLength(2);
    writeMetadata(path, [['name', 'Once']]);
    expect(metadataOf(path).filter(([name]) => name === 'name')).toEqual([['name', 'Once']]);
  });

  it('leaves nothing next to the file once done', () => {
    const path = copyOf('raster.mbtiles');
    writeMetadata(path, [['name', 'Renamed']]);
    expect(readdirSync(join(path, '..'))).toEqual(['raster.mbtiles']);
  });

  it('changes nothing when another program holds the write lock', () => {
    const path = copyOf('raster.mbtiles');
    const other = new DatabaseSync(path);
    other.exec('BEGIN IMMEDIATE');
    try {
      expect(() => writeMetadata(path, [['name', 'Renamed']])).toThrow(/locked|busy/i);
    } finally {
      other.exec('ROLLBACK');
      other.close();
    }
    expect(new Map(metadataOf(path)).get('name')).toBe('Raster tiles');
  });

  it("never creates a file where there's none", () => {
    const path = join(scratch, 'gone.mbtiles');
    expect(() => writeMetadata(path, [['name', 'x']])).toThrow();
    expect(existsSync(path)).toBe(false);
  });
});
