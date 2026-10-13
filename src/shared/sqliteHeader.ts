import { detectFormat } from './formats';
import type { DatabaseHeader, FileInfo, LoadError } from './protocol';

/** The database header is the first 100 bytes of the file. */
export const HEADER_SIZE = 100;

const MAGIC = 'SQLite format 3\u0000';
const ENCODINGS: Record<number, DatabaseHeader['textEncoding']> = {
  1: 'UTF-8',
  2: 'UTF-16le',
  3: 'UTF-16be',
};

export type HeaderResult = { header: DatabaseHeader } | { error: 'empty' | 'notSqlite' };

/**
 * Reads the database header as https://www.sqlite.org/fileformat.html#the_database_header
 * describes it. Encrypted databases have no readable header and count as not SQLite.
 */
export function parseHeader(bytes: Uint8Array, fileSize: number): HeaderResult {
  if (fileSize === 0) {
    return { error: 'empty' };
  }
  if (bytes.length < HEADER_SIZE || !hasMagic(bytes)) {
    return { error: 'notSqlite' };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER_SIZE);
  const rawPageSize = view.getUint16(16);
  const pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
  if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0) {
    return { error: 'notSqlite' };
  }

  // The page count in the header is only current if the same version last wrote both fields.
  const changeCounter = view.getUint32(24);
  const headerPages = view.getUint32(28);
  const versionValidFor = view.getUint32(92);
  const pageCount =
    headerPages > 0 && versionValidFor === changeCounter
      ? headerPages
      : Math.floor(fileSize / pageSize);

  const version = view.getUint32(96);
  return {
    header: {
      pageSize,
      pageCount,
      // A database that has never had a table written to it has no encoding yet; SQLite's default.
      textEncoding: ENCODINGS[view.getUint32(56)] ?? 'UTF-8',
      wal: bytes[18] === 2 && bytes[19] === 2,
      userVersion: view.getInt32(60),
      applicationId: view.getUint32(68),
      sqliteVersion: `${Math.floor(version / 1_000_000)}.${Math.floor(version / 1000) % 1000}.${version % 1000}`,
    },
  };
}

/** What the viewer shows for a file, from its name, its first bytes and its size. */
export function describeFile(
  path: string,
  bytes: Uint8Array,
  fileSize: number,
): { file: FileInfo } | { error: LoadError } {
  const result = parseHeader(bytes, fileSize);
  if ('error' in result) {
    return result;
  }
  const fileName = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  return {
    file: {
      fileName,
      fileSize,
      format: detectFormat(path, result.header.applicationId),
      header: result.header,
    },
  };
}

function hasMagic(bytes: Uint8Array): boolean {
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}
