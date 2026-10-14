import { gunzipSync, gzipSync, inflateSync } from 'node:zlib';
import { tileKind } from '../shared/tiles';

const EXTENSIONS: Record<string, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  gif: 'gif',
  gzip: 'pbf',
  zlib: 'pbf',
  pbf: 'pbf',
  empty: 'pbf',
};

/** The file extension a tile is saved with: its image format, `pbf` for vector tiles. */
export function tileExtension(stored: Uint8Array): string {
  return EXTENSIONS[tileKind(stored)] ?? 'bin';
}

/**
 * What to write for a tile saved under a name. Vector tiles are written uncompressed, as tile
 * servers hand them out and most tools read them, unless the name ends in `.gz`; everything
 * else as stored.
 */
export function tileBytes(stored: Uint8Array, fileName: string): Uint8Array {
  const kind = tileKind(stored);
  const compressed = fileName.toLowerCase().endsWith('.gz');
  if (kind === 'gzip') return compressed ? stored : gunzipSync(stored);
  if (kind === 'zlib') {
    const plain = inflateSync(stored);
    return compressed ? gzipSync(plain) : plain;
  }
  if (kind === 'pbf' || kind === 'empty') return compressed ? gzipSync(stored) : stored;
  return stored;
}
