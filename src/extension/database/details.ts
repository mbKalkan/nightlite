import type { DatabaseSync } from 'node:sqlite';
import type { ForeignKey, ObjectDetails } from '../../shared/protocol';

interface XInfoRow {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
  hidden: number;
}

/**
 * What the Schema page lists beside an object's CREATE statement: a table's or view's columns,
 * indexes and foreign keys, or an index's columns.
 */
export function readDetails(db: DatabaseSync, name: string): ObjectDetails {
  const type = (
    db.prepare('SELECT type FROM main.sqlite_schema WHERE name = ?').get(name) as
      { type: string } | undefined
  )?.type;
  if (type === 'index') {
    const keys = db
      .prepare('SELECT name, "desc", coll FROM pragma_index_xinfo(?) WHERE key = 1 ORDER BY seqno')
      .all(name) as { name: string | null; desc: number; coll: string }[];
    return {
      indexColumns: keys.map((key) => ({
        name: key.name,
        descending: key.desc === 1,
        collation: key.coll,
      })),
    };
  }
  if (type === 'trigger') return {};

  const columns = (
    db
      .prepare('SELECT name, type, "notnull", dflt_value, pk, hidden FROM pragma_table_xinfo(?)')
      .all(name) as unknown as XInfoRow[]
  ).map((column) => ({
    name: column.name,
    type: column.type,
    notNull: column.notnull === 1,
    defaultValue: column.dflt_value,
    primaryKey: column.pk,
    generated: column.hidden >= 2,
    hidden: column.hidden === 1,
  }));

  const indexes = (
    db
      .prepare('SELECT name, "unique", origin, partial FROM pragma_index_list(?) ORDER BY seq')
      .all(name) as { name: string; unique: number; origin: string; partial: number }[]
  ).map((index) => ({
    name: index.name,
    unique: index.unique === 1,
    origin: index.origin as 'c' | 'u' | 'pk',
    partial: index.partial === 1,
    columns: (
      db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(index.name) as {
        name: string | null;
      }[]
    ).map((column) => column.name),
  }));

  const keys = new Map<number, ForeignKey>();
  const rows = db
    .prepare(
      'SELECT id, "table", "from", "to", on_update, on_delete FROM pragma_foreign_key_list(?) ORDER BY id, seq',
    )
    .all(name) as {
    id: number;
    table: string;
    from: string;
    to: string | null;
    on_update: string;
    on_delete: string;
  }[];
  for (const row of rows) {
    let key = keys.get(row.id);
    if (!key) {
      key = {
        table: row.table,
        from: [],
        to: [],
        onUpdate: row.on_update,
        onDelete: row.on_delete,
      };
      keys.set(row.id, key);
    }
    key.from.push(row.from);
    key.to.push(row.to);
  }
  // SQLite lists a table's foreign keys last to first.
  return { columns, indexes, foreignKeys: [...keys.values()].reverse() };
}
