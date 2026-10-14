import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import { gunzipSync, inflateSync } from 'node:zlib';
import type { TileContent, TilePage } from '../../shared/protocol';
import { tileKind } from '../../shared/tiles';

/** Stored tiles larger than this are described, not read: real tiles are kilobytes. */
export const TILE_LIMIT = 16 * 1024 * 1024;
/** How large a compressed tile may grow when it's uncompressed. */
export const PLAIN_LIMIT = 64 * 1024 * 1024;
/** How far from a tile already listed a read may start before positions are estimated. */
const NEAR = 20_000;

/** A listed tile: its position in the list and its place. */
interface Anchor {
  position: number;
  column: number;
  row: number;
}

type Place = Pick<Anchor, 'column' | 'row'>;

const compare = (a: Place, b: Place) => a.column - b.column || a.row - b.row;

const SELECT = 'SELECT tile_column AS c, tile_row AS r FROM main.tiles WHERE zoom_level = ?';

/**
 * Lists one zoom level's tiles in the order of the tiles index, by column and then row, a page at
 * a time. As with rows (D-009), a far jump estimates the tile there from the places of the first
 * and last tiles, and reads near tiles already listed continue from them. With the count the list
 * is given, the ends are known too, so the first and last pages are exact.
 */
export class TileLister {
  private readonly anchors: Anchor[] = [];
  private readonly ends: { first: Place; last: Place } | undefined;
  private readonly statements = new Map<string, StatementSync>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly zoom: number,
  ) {
    const first = this.one(`${SELECT} ORDER BY tile_column, tile_row LIMIT 1`, [zoom]);
    const last = this.one(`${SELECT} ORDER BY tile_column DESC, tile_row DESC LIMIT 1`, [zoom]);
    if (first && last && [first, last].every((end) => this.placeable(end))) {
      this.ends = { first, last };
    }
  }

  /** `total` is the zoom level's tile count. */
  page(start: number, count: number, total: number): TilePage {
    if (!this.ends) {
      return this.read(`${SELECT} ORDER BY tile_column, tile_row LIMIT ? OFFSET ?`, [
        this.zoom,
        count,
        start,
      ], start, count);
    }
    const anchors = this.known(total);
    const last = start + count - 1;
    const below = nearest(anchors, start, -1);
    const above = nearest(anchors, last, 1);
    if (below && start - below.position <= NEAR) {
      return this.forward(below, start - below.position, start, count);
    }
    if (above && above.position - last <= NEAR) {
      return this.backward(above, above.position - last, last, count);
    }
    return this.forward({ position: start, ...this.estimate(start, total) }, 0, start, count);
  }

  /**
   * Where a tile is in the list, or would be if there's none at its place: counted from a tile
   * listed near it, else estimated, keeping clear of the tiles listed around it.
   */
  locate(column: number, row: number, total: number): number {
    const target = { column, row };
    if (!this.ends || total === 0) return 0;
    const anchors = this.known(total);
    let before: Anchor | undefined;
    let after: Anchor | undefined;
    for (const anchor of anchors) {
      if (compare(anchor, target) <= 0) {
        if (!before || compare(anchor, before) > 0) before = anchor;
      } else if (!after || compare(anchor, after) < 0) {
        after = anchor;
      }
    }
    if (before) {
      const between = this.countBetween(before, target);
      if (between <= NEAR) return this.place(before.position + between, target);
    }
    if (after) {
      const between = this.countBetween(target, after);
      if (between <= NEAR) return this.place(after.position - between, target);
    }
    if (!before) return 0;
    if (!after) return total;
    // More than NEAR tiles lie on each side, so the estimate keeps that far from both.
    const low = before.position + NEAR + 1;
    const high = after.position - NEAR - 1;
    const guess = Math.round(
      ((this.key(target) - this.key(this.ends.first)) /
        Math.max(1, this.key(this.ends.last) - this.key(this.ends.first) + 1)) *
        total,
    );
    return this.place(low <= high ? Math.min(high, Math.max(low, guess)) : Math.round((low + high) / 2), target);
  }

  /** Lists the tile at or after a place at `position`, so the list around it reads from there. */
  private place(position: number, target: Place): number {
    const found = this.one(
      `${SELECT} AND (tile_column, tile_row) >= (?, ?) ORDER BY tile_column, tile_row LIMIT 1`,
      [this.zoom, target.column, target.row],
    );
    if (found) this.remember({ position, ...found });
    return position;
  }

  /** Tiles from `from`, included, up to `to`, left out; counting stops past NEAR. */
  private countBetween(from: Place, to: Place): number {
    const row = this.statement(
      `SELECT count(*) AS n FROM (SELECT 1 FROM main.tiles WHERE zoom_level = ? AND (tile_column, tile_row) >= (?, ?) AND (tile_column, tile_row) < (?, ?) LIMIT ?)`,
    ).get(this.zoom, from.column, from.row, to.column, to.row, NEAR + 1) as { n: number };
    return row.n;
  }

  private forward(from: Anchor, skip: number, start: number, count: number): TilePage {
    return this.read(
      `${SELECT} AND (tile_column, tile_row) >= (?, ?) ORDER BY tile_column, tile_row LIMIT ? OFFSET ?`,
      [this.zoom, from.column, from.row, count, skip],
      start,
      count,
    );
  }

  /** Reads back from a listed tile, so the page meets it without gaps or repeats. */
  private backward(from: Anchor, skip: number, last: number, count: number): TilePage {
    const statement = this.statement(
      `${SELECT} AND (tile_column, tile_row) <= (?, ?) ORDER BY tile_column DESC, tile_row DESC LIMIT ? OFFSET ?`,
    );
    const rows = (
      statement.all(this.zoom, from.column, from.row, count, skip) as { c: unknown; r: unknown }[]
    ).reverse();
    const start = last - rows.length + 1;
    const tiles = rows.map(({ c, r }): [number, number] => [Number(c), Number(r)]);
    this.rememberPage(start, tiles);
    return { start, tiles, end: false };
  }

  private read(sql: string, params: SQLInputValue[], start: number, count: number): TilePage {
    const rows = this.statement(sql).all(...params) as { c: unknown; r: unknown }[];
    const tiles = rows.map(({ c, r }): [number, number] => [Number(c), Number(r)]);
    if (this.ends) this.rememberPage(start, tiles);
    return { start, tiles, end: rows.length < count };
  }

  private rememberPage(start: number, tiles: [number, number][]): void {
    if (tiles.length === 0) return;
    const [first, last] = [tiles[0], tiles[tiles.length - 1]];
    this.remember({ position: start, column: first[0], row: first[1] });
    this.remember({ position: start + tiles.length - 1, column: last[0], row: last[1] });
  }

  /**
   * Keeps a listed tile, dropping any it contradicts: a tile before it in the list must come
   * before it in the index too. Estimates far apart can disagree where tiles are sparse.
   */
  private remember(anchor: Anchor): void {
    for (let i = this.anchors.length - 1; i >= 0; i--) {
      const other = this.anchors[i];
      const order = compare(other, anchor);
      if (
        other.position === anchor.position ||
        (other.position < anchor.position && order >= 0) ||
        (other.position > anchor.position && order <= 0)
      ) {
        this.anchors.splice(i, 1);
      }
    }
    this.anchors.push(anchor);
    // A few hundred are plenty; drop the oldest.
    if (this.anchors.length > 400) this.anchors.splice(0, this.anchors.length - 400);
  }

  /** The listed tiles and both ends of the list. */
  private known(total: number): Anchor[] {
    const ends = this.ends as { first: Place; last: Place };
    return [
      { position: 0, ...ends.first },
      ...this.anchors,
      { position: Math.max(0, total - 1), ...ends.last },
    ];
  }

  /** The place a position falls on if the tiles between the ends were evenly spread. */
  private estimate(position: number, total: number): Place {
    const ends = this.ends as { first: Place; last: Place };
    const from = this.key(ends.first);
    const span = this.key(ends.last) - from + 1;
    const key = from + Math.floor((position / Math.max(1, total)) * span);
    const size = 2 ** this.zoom;
    const column = Math.floor(key / size);
    return { column, row: Math.max(0, key - column * size) };
  }

  /** A place as one number, in index order while rows stay below the zoom's size. */
  private key(place: Place): number {
    return place.column * 2 ** this.zoom + place.row;
  }

  private placeable(place: Place): boolean {
    return Number.isSafeInteger(place.column) && Number.isSafeInteger(place.row);
  }

  private one(sql: string, params: SQLInputValue[]): Place | undefined {
    const row = this.statement(sql).get(...params) as { c: unknown; r: unknown } | undefined;
    return row ? { column: Number(row.c), row: Number(row.r) } : undefined;
  }

  private statement(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }
}

function nearest(anchors: Anchor[], position: number, direction: -1 | 1): Anchor | undefined {
  let best: Anchor | undefined;
  for (const anchor of anchors) {
    const distance = (anchor.position - position) * direction;
    if (distance >= 0 && (!best || distance < (best.position - position) * direction)) {
      best = anchor;
    }
  }
  return best;
}

/**
 * One tile's bytes, uncompressed when stored with gzip or zlib, as vector tiles usually are.
 * Null when there's no tile at the place.
 */
export function readTile(
  db: DatabaseSync,
  zoom: number,
  column: number,
  row: number,
): TileContent | null {
  const found = db
    .prepare(
      `SELECT typeof(tile_data) AS t, length(tile_data) AS n, CASE WHEN length(tile_data) <= ${TILE_LIMIT} THEN tile_data END AS d FROM main.tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ? LIMIT 1`,
    )
    .get(zoom, column, row) as { t: string; n: number | null; d: unknown } | undefined;
  if (!found) return null;
  let stored: Uint8Array;
  if (found.t === 'blob') {
    // An empty BLOB comes back as null.
    stored = (found.d as Uint8Array | null) ?? new Uint8Array();
  } else if (found.t === 'null') {
    stored = new Uint8Array();
  } else {
    stored = new TextEncoder().encode(String(found.d ?? ''));
  }
  const size = found.t === 'blob' ? Number(found.n) : stored.length;
  if (found.t === 'blob' && found.d === null && size > 0) {
    return { size, compression: null, data: null, problem: 'tooLarge' };
  }
  const kind = tileKind(stored);
  if (kind !== 'gzip' && kind !== 'zlib') {
    // A copy of its own, so only the tile's bytes travel to the webview.
    return { size, compression: null, data: new Uint8Array(stored) };
  }
  try {
    const plain =
      kind === 'gzip'
        ? gunzipSync(stored, { maxOutputLength: PLAIN_LIMIT })
        : inflateSync(stored, { maxOutputLength: PLAIN_LIMIT });
    return { size, compression: kind, data: new Uint8Array(plain) };
  } catch (error) {
    const tooLarge = (error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE';
    return { size, compression: kind, data: null, problem: tooLarge ? 'tooLarge' : 'damaged' };
  }
}
