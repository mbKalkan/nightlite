import type { DatabaseSync } from 'node:sqlite';
import type { GeoPackageContent, GeoPackageSummary } from '../../shared/protocol';

interface ContentRow {
  table_name: string;
  data_type: string;
  identifier: string | null;
  description: string | null;
  min_x: number | null;
  min_y: number | null;
  max_x: number | null;
  max_y: number | null;
  srs_id: number | null;
}

/**
 * A GeoPackage's contents as its own tables list them (D-024): each feature, tile and attribute
 * table with its geometry column or zoom levels, its spatial reference system and bounds, and
 * the extensions in use. Tables a GeoPackage may leave out are left out here too.
 */
export function readGeoPackage(db: DatabaseSync): GeoPackageSummary {
  const tables = new Set(
    (
      db.prepare("SELECT name FROM sqlite_schema WHERE type IN ('table', 'view')").all() as {
        name: string;
      }[]
    ).map((row) => row.name),
  );
  if (!tables.has('gpkg_contents')) return { contents: null, extensions: [] };

  const srs = new Map<number, NonNullable<GeoPackageContent['srs']>>();
  if (tables.has('gpkg_spatial_ref_sys')) {
    const rows = db
      .prepare(
        'SELECT srs_id, srs_name, organization, organization_coordsys_id FROM gpkg_spatial_ref_sys',
      )
      .all() as {
      srs_id: number;
      srs_name: string | null;
      organization: string | null;
      organization_coordsys_id: number | null;
    }[];
    for (const row of rows) {
      srs.set(row.srs_id, {
        id: row.srs_id,
        name: row.srs_name ?? '',
        organization: row.organization,
        code: row.organization_coordsys_id,
      });
    }
  }
  const geometries = new Map<string, NonNullable<GeoPackageContent['geometry']>>();
  if (tables.has('gpkg_geometry_columns')) {
    const rows = db
      .prepare(
        'SELECT table_name, column_name, geometry_type_name, z, m FROM gpkg_geometry_columns',
      )
      .all() as {
      table_name: string;
      column_name: string;
      geometry_type_name: string;
      z: number;
      m: number;
    }[];
    for (const row of rows) {
      // Table names are matched as SQLite matches them, without regard to case.
      geometries.set(row.table_name.toLowerCase(), {
        column: row.column_name,
        type: row.geometry_type_name,
        z: row.z,
        m: row.m,
      });
    }
  }
  const zooms = new Map<string, NonNullable<GeoPackageContent['zooms']>>();
  if (tables.has('gpkg_tile_matrix')) {
    const rows = db
      .prepare(
        'SELECT table_name, min(zoom_level) AS lo, max(zoom_level) AS hi FROM gpkg_tile_matrix GROUP BY table_name',
      )
      .all() as { table_name: string; lo: number; hi: number }[];
    for (const row of rows) zooms.set(row.table_name.toLowerCase(), { min: row.lo, max: row.hi });
  }

  const rows = db
    .prepare(
      'SELECT table_name, data_type, identifier, description, min_x, min_y, max_x, max_y, srs_id FROM gpkg_contents',
    )
    .all() as unknown as ContentRow[];
  const contents = rows.map((row): GeoPackageContent => {
    const key = row.table_name.toLowerCase();
    const bounded = [row.min_x, row.min_y, row.max_x, row.max_y].every(
      (value) => typeof value === 'number',
    );
    return {
      table: row.table_name,
      dataType: row.data_type,
      identifier: row.identifier || null,
      description: row.description || null,
      bounds: bounded
        ? [row.min_x as number, row.min_y as number, row.max_x as number, row.max_y as number]
        : null,
      srs:
        row.srs_id === null
          ? null
          : (srs.get(row.srs_id) ?? { id: row.srs_id, name: '', organization: null, code: null }),
      geometry: geometries.get(key) ?? null,
      zooms: zooms.get(key) ?? null,
    };
  });

  const extensions = tables.has('gpkg_extensions')
    ? (
        db
          .prepare('SELECT table_name, column_name, extension_name, scope FROM gpkg_extensions')
          .all() as {
          table_name: string | null;
          column_name: string | null;
          extension_name: string;
          scope: string | null;
        }[]
      ).map((row) => ({
        table: row.table_name,
        column: row.column_name,
        name: row.extension_name,
        scope: row.scope,
      }))
    : [];
  return { contents, extensions };
}
