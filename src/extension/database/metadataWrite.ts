import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

/** A metadata key and its new value, or null to remove it. */
export type MetadataChange = [name: string, value: string | null];

/**
 * Writes metadata changes into an MBTiles file (D-005): on a connection of its own, closed right
 * after, in one transaction, with the extension's own statements, to the metadata table only.
 * `BEGIN IMMEDIATE` takes the write lock first, so a busy file fails before anything changes. A
 * key is written once, however many times the file had it. `mode=rw` opens the file as it is and
 * never creates one where it's gone.
 */
export function writeMetadata(path: string, changes: readonly MetadataChange[]): void {
  const db = new DatabaseSync(`${pathToFileURL(path).href}?mode=rw`, { timeout: 2000 });
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const remove = db.prepare('DELETE FROM main.metadata WHERE name = ?');
      const insert = db.prepare('INSERT INTO main.metadata (name, value) VALUES (?, ?)');
      for (const [name, value] of changes) {
        remove.run(name);
        if (value !== null) insert.run(name, value);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}
