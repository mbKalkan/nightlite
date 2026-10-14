import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  flipRow,
  parseTileAddress,
  stepTile,
  tileAddress,
  tileAt,
  tileKind,
} from '../../src/shared/tiles';

describe('tile addresses', () => {
  it('flips rows between XYZ and TMS', () => {
    expect(flipRow(0, 0)).toBe(0);
    expect(flipRow(14, 0)).toBe(16383);
    expect(flipRow(14, flipRow(14, 5412))).toBe(5412);
    expect(tileAddress({ zoom: 14, column: 8723, row: 10971 }, 'xyz')).toBe('14/8723/5412');
    expect(tileAddress({ zoom: 14, column: 8723, row: 10971 }, 'tms')).toBe('14/8723/10971');
  });

  it('reads z/x/y as typed, in either scheme', () => {
    expect(parseTileAddress('14/8723/5412', 'xyz')).toEqual({ zoom: 14, column: 8723, row: 10971 });
    expect(parseTileAddress(' 14 8723 5412 ', 'xyz')).toEqual({
      zoom: 14,
      column: 8723,
      row: 10971,
    });
    expect(parseTileAddress('14,8723,5412', 'tms')).toEqual({ zoom: 14, column: 8723, row: 5412 });
    expect(parseTileAddress('0/0/0', 'xyz')).toEqual({ zoom: 0, column: 0, row: 0 });
  });

  it('reads the last three numbers of a tile URL', () => {
    expect(
      parseTileAddress('https://tiles.example.com/v3/14/8723/5412.pbf?key=12345#map=2/0/0', 'xyz'),
    ).toEqual({ zoom: 14, column: 8723, row: 10971 });
    expect(parseTileAddress('http://localhost:8080/data/5/16/11.png', 'xyz')).toEqual({
      zoom: 5,
      column: 16,
      row: 20,
    });
    expect(parseTileAddress('/tiles/3/2/1/', 'tms')).toEqual({ zoom: 3, column: 2, row: 1 });
  });

  it('turns down what is not a tile', () => {
    for (const text of ['', 'abc', '1/2', '2/4/0', '2/0/4', `${MAX_ZOOM + 1}/0/0`, '1.5/0/0']) {
      expect(parseTileAddress(text, 'xyz'), text).toBeUndefined();
    }
  });

  it('finds the tile holding a place', () => {
    // London at zoom 10 is 511/340 in tile URLs.
    expect(tileAt(-0.1278, 51.5074, 10)).toEqual({ zoom: 10, column: 511, row: flipRow(10, 340) });
    expect(tileAt(0, 0, 1)).toEqual({ zoom: 1, column: 1, row: 0 });
    expect(tileAt(0, 0, 0)).toEqual({ zoom: 0, column: 0, row: 0 });
    // The poles and the antimeridian stay on the map.
    expect(tileAt(180, 90, 3)).toEqual({ zoom: 3, column: 7, row: 7 });
    expect(tileAt(-180, -90, 3)).toEqual({ zoom: 3, column: 0, row: 0 });
  });
});

describe('stepTile', () => {
  const tile = { zoom: 2, column: 1, row: 1 };

  it('moves to the tiles around, north up', () => {
    expect(stepTile(tile, 'west')).toEqual({ zoom: 2, column: 0, row: 1 });
    expect(stepTile(tile, 'east')).toEqual({ zoom: 2, column: 2, row: 1 });
    expect(stepTile(tile, 'north')).toEqual({ zoom: 2, column: 1, row: 2 });
    expect(stepTile(tile, 'south')).toEqual({ zoom: 2, column: 1, row: 0 });
  });

  it('zooms in to the north-west quarter and out to the tile holding it', () => {
    const inner = stepTile(tile, 'in');
    expect(inner).toEqual({ zoom: 3, column: 2, row: 3 });
    expect(tileAddress(inner!, 'xyz')).toBe('3/2/4');
    expect(tileAddress(tile, 'xyz')).toBe('2/1/2');
    expect(stepTile(inner!, 'out')).toEqual(tile);
  });

  it('stops at the edges of the world and the zoom levels', () => {
    expect(stepTile({ zoom: 0, column: 0, row: 0 }, 'west')).toBeUndefined();
    expect(stepTile({ zoom: 0, column: 0, row: 0 }, 'north')).toBeUndefined();
    expect(stepTile({ zoom: 0, column: 0, row: 0 }, 'out')).toBeUndefined();
    expect(stepTile({ zoom: 1, column: 1, row: 0 }, 'east')).toBeUndefined();
    expect(stepTile({ zoom: 1, column: 1, row: 0 }, 'south')).toBeUndefined();
    expect(stepTile({ zoom: MAX_ZOOM, column: 0, row: 0 }, 'in')).toBeUndefined();
  });
});

describe('tileKind', () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it('tells tiles apart by their first bytes', () => {
    expect(tileKind(bytes())).toBe('empty');
    expect(tileKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBe('png');
    expect(tileKind(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
    expect(tileKind(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(tileKind(new TextEncoder().encode('GIF89a'))).toBe('gif');
    expect(tileKind(bytes(0x1f, 0x8b, 0x08))).toBe('gzip');
    expect(tileKind(bytes(0x78, 0x9c))).toBe('zlib');
    expect(tileKind(bytes(0x78, 0xda))).toBe('zlib');
    expect(tileKind(bytes(0x1a, 0x05))).toBe('pbf');
    expect(tileKind(new TextEncoder().encode('RIFF\0\0\0\0WAVE'))).toBe('unknown');
    expect(tileKind(bytes(0x78, 0x00))).toBe('unknown');
  });
});
