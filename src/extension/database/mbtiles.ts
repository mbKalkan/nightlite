import type { DatabaseSync } from 'node:sqlite';
import type { MbtilesSummary, ZoomRange } from '../../shared/protocol';

/** Metadata values longer than this are cut: a tileset's `json` is tens of kilobytes at most. */
const VALUE_LIMIT = 1024 * 1024;
const ROW_LIMIT = 1000;

const kindOf = (db: DatabaseSync, name: string) =>
  (
    db
      .prepare("SELECT type FROM pragma_table_list WHERE schema = 'main' AND name = ?")
      .get(name) as { type: string } | undefined
  )?.type;

/** The metadata table's rows as text, and what kind of object `tiles` is. */
export function readMbtiles(db: DatabaseSync): MbtilesSummary {
  const metadataKind = kindOf(db, 'metadata');
  const tilesKind = kindOf(db, 'tiles');
  let metadata: [string, string][] | null = null;
  if (metadataKind === 'table' || metadataKind === 'view') {
    const rows = db
      .prepare(
        `SELECT CAST(name AS TEXT) AS name, substr(CAST(value AS TEXT), 1, ${VALUE_LIMIT}) AS value FROM main.metadata LIMIT ${ROW_LIMIT}`,
      )
      .all() as { name: string | null; value: string | null }[];
    metadata = rows.map((row) => [row.name ?? '', row.value ?? '']);
  }
  const tiles =
    tilesKind === 'table' || tilesKind === 'view' || tilesKind === 'virtual' ? tilesKind : null;
  return { metadata, tiles };
}

/**
 * The lowest and highest zoom levels with tiles. Each end is one lookup in the tiles index; min()
 * and max() in one SELECT would read all of it (11 s on a 24 GB file).
 */
export function zoomRange(db: DatabaseSync): ZoomRange | null {
  const row = db
    .prepare(
      'SELECT (SELECT min(zoom_level) FROM main.tiles) AS lo, (SELECT max(zoom_level) FROM main.tiles) AS hi',
    )
    .get() as { lo: unknown; hi: unknown };
  const min = Number(row.lo);
  const max = Number(row.hi);
  if (row.lo === null || row.hi === null || !Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  return { min, max };
}

export function zoomCount(db: DatabaseSync, zoom: number): number {
  const row = db.prepare('SELECT count(*) AS n FROM main.tiles WHERE zoom_level = ?').get(zoom) as {
    n: number;
  };
  return row.n;
}
