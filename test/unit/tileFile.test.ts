import { gunzipSync, deflateSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { tileBytes, tileExtension } from '../../src/extension/tileFile';

const vector = new Uint8Array([0x1a, 0x03, 0x0a, 0x01, 0x61]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('tileExtension', () => {
  it('names images by their format and vector tiles pbf', () => {
    expect(tileExtension(png)).toBe('png');
    expect(tileExtension(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('jpg');
    expect(tileExtension(new TextEncoder().encode('RIFF\0\0\0\0WEBP'))).toBe('webp');
    expect(tileExtension(new TextEncoder().encode('GIF89a'))).toBe('gif');
    expect(tileExtension(gzipSync(vector))).toBe('pbf');
    expect(tileExtension(deflateSync(vector))).toBe('pbf');
    expect(tileExtension(vector)).toBe('pbf');
    expect(tileExtension(new Uint8Array())).toBe('pbf');
    expect(tileExtension(new Uint8Array([0x00, 0x01]))).toBe('bin');
  });
});

describe('tileBytes', () => {
  it('writes vector tiles uncompressed, unless the name ends in .gz', () => {
    expect(tileBytes(gzipSync(vector), '1-1-1.pbf')).toEqual(Buffer.from(vector));
    expect(tileBytes(deflateSync(vector), '1-1-1.mvt')).toEqual(Buffer.from(vector));
    expect(tileBytes(vector, '1-1-1.pbf')).toEqual(vector);
    const stored = gzipSync(vector);
    expect(tileBytes(stored, '1-1-1.pbf.gz')).toBe(stored);
    expect(gunzipSync(tileBytes(deflateSync(vector), '1-1-1.GZ'))).toEqual(Buffer.from(vector));
    expect(gunzipSync(tileBytes(vector, 'tile.gz'))).toEqual(Buffer.from(vector));
  });

  it('writes images and anything else as stored', () => {
    expect(tileBytes(png, '0-0-0.png')).toBe(png);
    expect(tileBytes(png, '0-0-0.png.gz')).toBe(png);
  });
});
