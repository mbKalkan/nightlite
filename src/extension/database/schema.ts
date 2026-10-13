import type { DatabaseSync } from 'node:sqlite';
import type { ObjectType, SchemaObject } from '../../shared/protocol';

interface SchemaRow {
  type: ObjectType;
  name: string;
  tbl_name: string;
  sql: string | null;
}

interface TableListRow {
  name: string;
  type: 'table' | 'view' | 'shadow' | 'virtual';
  wr: number;
  strict: number;
}

/**
 * Lists the database's tables, views, indexes and triggers by name. Indexes SQLite made itself
 * for UNIQUE and PRIMARY KEY constraints are left out; they belong to their table's schema.
 */
export function readSchema(db: DatabaseSync): SchemaObject[] {
  const traits = new Map<string, TableListRow>();
  try {
    for (const row of db
      .prepare("SELECT name, type, wr, strict FROM pragma_table_list WHERE schema = 'main'")
      .all() as unknown as TableListRow[]) {
      traits.set(row.name, row);
    }
  } catch {
    // A virtual table whose module SQLite doesn't have can stop this; the SQL text still tells.
  }

  const rows = db
    .prepare(
      `SELECT type, name, tbl_name, sql FROM sqlite_schema
       WHERE type IN ('table', 'view', 'index', 'trigger') AND NOT (type = 'index' AND sql IS NULL)
       ORDER BY name COLLATE NOCASE`,
    )
    .all() as unknown as SchemaRow[];

  return rows.map((row) => {
    const trait = traits.get(row.name);
    return {
      type: row.type,
      name: row.name,
      tableName: row.tbl_name,
      sql: row.sql,
      internal: row.name.startsWith('sqlite_') || trait?.type === 'shadow',
      virtual: trait
        ? trait.type === 'virtual'
        : /^\s*create\s+virtual\s+table\b/i.test(row.sql ?? ''),
      withoutRowid: trait?.wr === 1,
      strict: trait?.strict === 1,
    };
  });
}
