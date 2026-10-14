import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { readMbtiles, zoomCount, zoomRange } from '../../src/extension/database/mbtiles';
import { checkMetadataValue, readTileset } from '../../src/shared/mbtiles';

const open = (name: string) => new DatabaseSync(`test/fixtures/${name}`, { readOnly: true });
const vector = open('sample.mbtiles');
const raster = open('raster.mbtiles');
const dedup = open('dedup.mbtiles');
const plain = open('sample.sqlite');
afterAll(() => [vector, raster, dedup, plain].forEach((db) => db.close()));

describe('readTileset', () => {
  it('reads the keys the spec defines and the vector layers', () => {
    const tileset = readTileset(readMbtiles(vector).metadata ?? []);
    expect(tileset).toMatchObject({
      name: 'Sample tiles',
      description: 'Places, roads and water for tests',
      format: 'pbf',
      type: 'overlay',
      version: '1',
      minzoom: 0,
      maxzoom: 2,
      bounds: [-180, -85.05112878, 180, 85.05112878],
      center: [0, 0, 1],
      attribution: 'Generated test data',
      missing: [],
      invalid: [],
      other: [],
    });
    expect(tileset.layers?.map((layer) => layer.id)).toEqual(['places', 'roads', 'water']);
    expect(tileset.layers?.[0]).toMatchObject({
      description: 'Named points',
      minzoom: 0,
      maxzoom: 2,
      fields: [
        ['name', 'String'],
        ['population', 'Number'],
        ['capital', 'Boolean'],
      ],
    });
  });

  it('says which keys are missing or unreadable, and keeps the others', () => {
    const tileset = readTileset([
      ['name', 'Broken'],
      ['format', 'PBF'],
      ['minzoom', '2.5'],
      ['bounds', '1,2,3'],
      ['json', '{"vector_layers": "no"}'],
      ['generator', 'tippecanoe v2'],
      ['name', 'Second name'],
    ]);
    expect(tileset.name).toBe('Broken');
    expect(tileset.format).toBe('pbf');
    expect(tileset.invalid).toEqual(['minzoom', 'bounds', 'json']);
    expect(tileset.missing).toEqual(['center', 'maxzoom']);
    expect(tileset.other).toEqual([['generator', 'tippecanoe v2']]);
  });

  it("doesn't ask raster tilesets for vector layers", () => {
    const tileset = readTileset(readMbtiles(raster).metadata ?? []);
    expect(tileset.format).toBe('png');
    expect(tileset.layers).toBeUndefined();
    expect(tileset.missing).toEqual(['center']);
  });

  it('adds feature counts and geometry from tilestats', () => {
    const json = JSON.stringify({
      vector_layers: [{ id: 'roads', fields: {} }],
      tilestats: { layers: [{ layer: 'roads', count: 1234, geometry: 'LineString' }] },
    });
    const [roads] = readTileset([['json', json]]).layers ?? [];
    expect(roads).toMatchObject({ id: 'roads', features: 1234, geometry: 'LineString' });
  });
});

describe('MBTiles queries', () => {
  it('reads the metadata and tells a tiles table from a view', () => {
    expect(readMbtiles(vector).tiles).toBe('table');
    expect(readMbtiles(dedup).tiles).toBe('view');
    expect(readMbtiles(plain)).toEqual({ metadata: null, tiles: null });
  });

  it('counts tiles by zoom level', () => {
    expect(zoomRange(vector)).toEqual({ min: 0, max: 2 });
    expect([0, 1, 2].map((zoom) => zoomCount(vector, zoom))).toEqual([1, 4, 16]);
    expect(zoomRange(dedup)).toEqual({ min: 0, max: 1 });
    expect(zoomCount(dedup, 1)).toBe(4);
  });
});

describe('checkMetadataValue', () => {
  it('reads values the way the MBTiles 1.3 spec defines their keys', () => {
    const fine: [string, string][] = [
      ['format', 'pbf'],
      ['format', 'JPEG'],
      ['bounds', '-180,-85.05112878,180,85.05112878'],
      ['bounds', ' 28.9, 41 , 29.1,41.1 '],
      ['center', '28.98,41.01,12'],
      ['center', '0,0'],
      ['minzoom', '0'],
      ['maxzoom', '22'],
      ['type', 'baselayer'],
      ['json', '{"vector_layers":[]}'],
      ['anything', 'goes'],
    ];
    for (const [name, value] of fine) expect(checkMetadataValue(name, value), name).toBeUndefined();
  });

  it('says what is wrong with values that read otherwise', () => {
    const wrong: [string, string, string][] = [
      ['format', 'image/png', 'format'],
      ['bounds', '-180,-85,180', 'bounds'],
      ['bounds', '-190,-85,180,85', 'bounds'],
      ['bounds', '0,10,1,5', 'bounds'],
      ['center', '28.98,41.01,12.5', 'center'],
      ['center', '28.98', 'center'],
      ['minzoom', '', 'zoom'],
      ['maxzoom', '2.5', 'zoom'],
      ['maxzoom', '31', 'zoom'],
      ['type', 'base', 'type'],
      ['json', '[1, 2]', 'json'],
      ['json', '{oops', 'json'],
    ];
    for (const [name, value, issue] of wrong) {
      expect(checkMetadataValue(name, value), `${name}=${value}`).toBe(issue);
    }
  });
});
