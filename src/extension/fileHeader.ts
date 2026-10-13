import { open } from 'node:fs/promises';
import { HEADER_SIZE } from '../shared/sqliteHeader';

/**
 * Reads only the first bytes of a file and its size. Databases can be tens of gigabytes, so
 * files are never read whole; opening with 'r' creates nothing next to the file.
 */
export async function readFileHeader(path: string): Promise<{ bytes: Uint8Array; size: number }> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const bytes = new Uint8Array(HEADER_SIZE);
    const { bytesRead } = await handle.read(bytes, 0, HEADER_SIZE, 0);
    return { bytes: bytes.subarray(0, bytesRead), size };
  } finally {
    await handle.close();
  }
}
