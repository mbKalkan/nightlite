import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { DatabaseFailure } from '../../src/extension/database/client';
import { readSchema } from '../../src/extension/database/schema';
import { connectionTarget } from '../../src/extension/database/target';
import { classifyDatabaseError } from '../../src/extension/databaseDocument';

const scratch = mkdtempSync(join(tmpdir(), 'nightlite-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const schemaOf = (path: string) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return readSchema(db);
  } finally {
    db.close();
  }
};

describe('connectionTarget', () => {
  const none = () => false;
  const all = () => true;

  it('opens rollback-journal databases by their path', () => {
    expect(connectionTarget('C:\\data\\app.db', false, none)).toBe('C:\\data\\app.db');
  });

  it('opens a WAL database as immutable when its log files are missing', () => {
    const path = resolve('test/fixtures/my app.db');
    const target = connectionTarget(path, true, none);
    expect(target).toBe(`${pathToFileURL(path).href}?mode=ro&immutable=1`);
    expect(target).toMatch(/^file:\/\/.*my%20app\.db\?/);
  });

  it('opens a WAL database by its path while another program has its log files', () => {
    expect(connectionTarget('/data/app.db', true, all)).toBe('/data/app.db');
  });

  it('creates nothing next to the WAL fixture', () => {
    const path = 'test/fixtures/wal.sqlite';
    const db = new DatabaseSync(connectionTarget(path, true), { readOnly: true });
    expect(db.prepare('SELECT count(*) AS n FROM notes').get()?.n).toBe(1);
    db.close();
    expect(schemaOf(connectionTarget(path, true)).map((object) => object.name)).toEqual(['notes']);
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(`${path}-shm`)).toBe(false);
  });
});

describe('readSchema', () => {
  it('lists tables, views, indexes and triggers by name, leaving out automatic indexes', () => {
    const objects = schemaOf('test/fixtures/sample.sqlite');
    expect(objects.filter((o) => o.type === 'table').map((o) => o.name)).toEqual([
      'album_tags',
      'albums',
      'artists',
      'empty_table',
      'events',
      'order items',
      'tags',
      'typed',
      'value_kinds',
      'wide',
    ]);
    expect(objects.find((o) => o.type === 'view')?.name).toBe('album_list');
    expect(objects.filter((o) => o.type === 'index').map((o) => o.name)).toEqual([
      'albums_by_artist',
    ]);
    expect(objects.find((o) => o.type === 'trigger')).toMatchObject({
      name: 'albums_unrated',
      tableName: 'albums',
    });
  });

  it('marks WITHOUT ROWID and STRICT tables', () => {
    const objects = schemaOf('test/fixtures/sample.sqlite');
    expect(objects.find((o) => o.name === 'tags')).toMatchObject({ withoutRowid: true });
    expect(objects.find((o) => o.name === 'typed')).toMatchObject({ strict: true });
    expect(objects.find((o) => o.name === 'artists')).toMatchObject({
      withoutRowid: false,
      strict: false,
      internal: false,
      virtual: false,
    });
  });

  it("marks SQLite's own tables as internal", () => {
    const objects = schemaOf('test/fixtures/sample.gpkg');
    expect(objects.find((o) => o.name === 'sqlite_sequence')).toMatchObject({ internal: true });
    expect(objects.find((o) => o.name === 'cities')).toMatchObject({ internal: false });
  });

  it('tells virtual tables from the tables that hold their data', () => {
    const path = join(scratch, 'virtual.db');
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE VIRTUAL TABLE notes USING fts5(body);
      PRAGMA writable_schema = ON;
      INSERT INTO sqlite_schema VALUES
        ('table', 'mystery', 'mystery', 0, 'CREATE VIRTUAL TABLE mystery USING nosuchmodule(a)');
    `);
    db.close();
    const objects = schemaOf(path);
    expect(objects.find((o) => o.name === 'notes')).toMatchObject({
      virtual: true,
      internal: false,
    });
    expect(objects.find((o) => o.name === 'notes_content')).toMatchObject({ internal: true });
    expect(objects.find((o) => o.name === 'mystery')).toMatchObject({ virtual: true });
  });

  it('reads the schema of a database whose table pages are damaged', () => {
    expect(schemaOf('test/fixtures/corrupt.sqlite').map((o) => o.name)).toEqual(['readings']);
  });
});

describe('classifyDatabaseError', () => {
  it("explains SQLite's result codes, extended ones included", () => {
    const failure = (code: number) => new DatabaseFailure({ code, message: `code ${code}` });
    expect(classifyDatabaseError(failure(11))).toEqual({ error: 'damaged', detail: 'code 11' });
    expect(classifyDatabaseError(failure(26)).error).toBe('notSqlite');
    expect(classifyDatabaseError(failure(5)).error).toBe('locked');
    expect(classifyDatabaseError(failure(517)).error).toBe('locked'); // SQLITE_BUSY_SNAPSHOT
    expect(classifyDatabaseError(failure(14)).error).toBe('unreadable');
    expect(classifyDatabaseError(failure(1)).error).toBe('other');
    expect(classifyDatabaseError(new Error('worker stopped'))).toEqual({
      error: 'other',
      detail: 'worker stopped',
    });
  });
});
