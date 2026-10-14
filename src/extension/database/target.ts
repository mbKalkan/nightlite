import { existsSync } from 'node:fs';
import type { DatabaseSyncOptions } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

/**
 * How the viewer opens every database: read-only, waiting a little for a writer's lock, and
 * reading double-quoted strings as SQLite's own shell does. GDAL writes GeoPackage views with
 * them (`"ST_" || geometry_type_name`), which a stricter connection can't read at all.
 */
export const READ_OPTIONS: DatabaseSyncOptions = {
  readOnly: true,
  timeout: 2000,
  enableDoubleQuotedStringLiterals: true,
};

/**
 * What to hand SQLite to open a database read-only without creating anything next to it
 * (D-003). A read-only connection to a WAL database creates its -wal and -shm files unless
 * they exist already, so without them the database is opened as immutable: with no write-ahead
 * log on disk, all its data is in the main file. The URI must be a string; SQLite ignores the
 * parameters of a URL object.
 */
export function connectionTarget(
  path: string,
  wal: boolean,
  exists: (path: string) => boolean = existsSync,
): string {
  if (!wal || (exists(`${path}-wal`) && exists(`${path}-shm`))) {
    return path;
  }
  return `${pathToFileURL(path).href}?mode=ro&immutable=1`;
}
