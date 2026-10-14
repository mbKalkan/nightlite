import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { readGeoPackage } from '../../src/extension/database/geopackage';
import { READ_OPTIONS } from '../../src/extension/database/target';

describe('readGeoPackage', () => {
  it('lists the contents with their geometry, zoom levels, SRS and bounds', () => {
    const db = new DatabaseSync('test/fixtures/sample.gpkg', READ_OPTIONS);
    try {
      const { contents, extensions } = readGeoPackage(db);
      expect(contents?.map((content) => content.table)).toEqual([
        'cities',
        'regions',
        'routes',
        'basemap',
        'notes',
      ]);
      expect(contents?.[1]).toEqual({
        table: 'regions',
        dataType: 'features',
        identifier: 'Regions',
        description: 'Two regions, one of them with a lake',
        bounds: [26, 36, 33, 42],
        srs: { id: 4326, name: 'WGS 84 geodetic', organization: 'EPSG', code: 4326 },
        geometry: { column: 'geom', type: 'MULTIPOLYGON', z: 0, m: 0 },
        zooms: null,
      });
      expect(contents?.[3]).toMatchObject({ dataType: 'tiles', zooms: { min: 0, max: 1 } });
      expect(contents?.[4]).toMatchObject({ bounds: null, srs: null, geometry: null });
      expect(extensions).toEqual([
        { table: 'regions', column: 'geom', name: 'gpkg_rtree_index', scope: 'write-only' },
      ]);
    } finally {
      db.close();
    }
  });

  it('says when a file has no gpkg_contents', () => {
    const db = new DatabaseSync('test/fixtures/sample.sqlite', READ_OPTIONS);
    try {
      expect(readGeoPackage(db)).toEqual({ contents: null, extensions: [] });
    } finally {
      db.close();
    }
  });
});
