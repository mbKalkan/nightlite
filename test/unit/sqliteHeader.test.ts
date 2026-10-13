import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HEADER_SIZE, describeFile, parseHeader } from '../../src/shared/sqliteHeader';

const fixture = (name: string) => {
  const path = `test/fixtures/${name}`;
  return { path, bytes: readFileSync(path).subarray(0, HEADER_SIZE), size: statSync(path).size };
};

/** The header of sample.sqlite, copied so a test can change fields. */
const sampleHeader = () => {
  const { bytes, size } = fixture('sample.sqlite');
  return { bytes: Uint8Array.from(bytes), size };
};

describe('parseHeader', () => {
  it('reads the facts SQLite keeps in the header', () => {
    const { bytes, size } = sampleHeader();
    const result = parseHeader(bytes, size);
    expect(result).toHaveProperty('header');
    if (!('header' in result)) return;
    expect(result.header).toMatchObject({
      pageSize: 4096,
      pageCount: size / 4096,
      textEncoding: 'UTF-8',
      wal: false,
      userVersion: 7,
      applicationId: 0,
    });
    expect(result.header.sqliteVersion).toMatch(/^3\.\d+\.\d+$/);
  });

  it('tells an empty file from one that is not a database', () => {
    expect(parseHeader(new Uint8Array(), 0)).toEqual({ error: 'empty' });
    const text = fixture('not-sqlite.sqlite');
    expect(parseHeader(text.bytes, text.size)).toEqual({ error: 'notSqlite' });
  });

  it('rejects a header cut short or with an impossible page size', () => {
    const { bytes, size } = sampleHeader();
    expect(parseHeader(bytes.subarray(0, 50), size)).toEqual({ error: 'notSqlite' });
    new DataView(bytes.buffer).setUint16(16, 1000);
    expect(parseHeader(bytes, size)).toEqual({ error: 'notSqlite' });
  });

  it('reads a page size of 1 as 65536', () => {
    const { bytes } = sampleHeader();
    new DataView(bytes.buffer).setUint16(16, 1);
    const result = parseHeader(bytes, 65536 * 3);
    expect('header' in result && result.header.pageSize).toBe(65536);
  });

  it('counts pages from the file size when the header count is stale', () => {
    const { bytes, size } = sampleHeader();
    // A different "version valid for" number means another program changed the file since.
    new DataView(bytes.buffer).setUint32(92, 12345);
    new DataView(bytes.buffer).setUint32(28, 999);
    const result = parseHeader(bytes, size);
    expect('header' in result && result.header.pageCount).toBe(size / 4096);
  });

  it('recognizes write-ahead logging and other text encodings', () => {
    const { bytes, size } = sampleHeader();
    bytes[18] = 2;
    bytes[19] = 2;
    new DataView(bytes.buffer).setUint32(56, 2);
    const result = parseHeader(bytes, size);
    expect('header' in result && result.header).toMatchObject({
      wal: true,
      textEncoding: 'UTF-16le',
    });
  });
});

describe('parseHeader on the fixtures', () => {
  it('sees the write-ahead log of a WAL database', () => {
    const { bytes, size } = fixture('wal.sqlite');
    expect('header' in parseHeader(bytes, size) && parseHeader(bytes, size)).toMatchObject({
      header: { wal: true },
    });
  });

  it('reads the header of a database with no tables, and of one whose pages are damaged', () => {
    for (const name of ['no-tables.sqlite', 'corrupt.sqlite']) {
      const { bytes, size } = fixture(name);
      expect(parseHeader(bytes, size), name).toHaveProperty('header');
    }
  });
});

describe('describeFile', () => {
  it('names the format from the application ID the file declares', () => {
    for (const [name, format] of [
      ['sample.sqlite', 'sqlite'],
      ['sample.mbtiles', 'mbtiles'],
      ['sample.gpkg', 'geopackage'],
    ]) {
      const { path, bytes, size } = fixture(name);
      const result = describeFile(path, bytes, size);
      expect('file' in result && result.file.format, name).toBe(format);
      expect('file' in result && result.file.fileName).toBe(name);
    }
  });

  it('falls back to the file name when the file declares nothing', () => {
    const { bytes, size } = fixture('sample.sqlite');
    const result = describeFile('C:\\maps\\world.mbtiles', bytes, size);
    expect('file' in result && result.file).toMatchObject({
      fileName: 'world.mbtiles',
      format: 'mbtiles',
    });
  });
});
