import type { FileFormat } from './protocol';

/** File types the viewer opens by default, with the leading dot. */
const EXTENSION_FORMATS: Readonly<Record<string, FileFormat>> = {
  '.sqlite': 'sqlite',
  '.sqlite3': 'sqlite',
  '.db3': 'sqlite',
  '.db': 'sqlite',
  '.mbtiles': 'mbtiles',
  '.gpkg': 'geopackage',
};

export const SUPPORTED_EXTENSIONS: readonly string[] = Object.keys(EXTENSION_FORMATS);

/** `PRAGMA application_id` values that name a format: 'GPKG', 'GP10', 'GP11' and 'MPBX'. */
const GEOPACKAGE_IDS = [0x47504b47, 0x47503130, 0x47503131];
const MBTILES_ID = 0x4d504258;

export function extensionFormat(path: string): FileFormat | undefined {
  const dot = path.lastIndexOf('.');
  if (dot < 0 || dot < path.lastIndexOf('/') || dot < path.lastIndexOf('\\')) {
    return undefined;
  }
  return EXTENSION_FORMATS[path.slice(dot).toLowerCase()];
}

/** The file's own declaration wins over its name; any other SQLite file is a plain database. */
export function detectFormat(path: string, applicationId: number): FileFormat {
  if (GEOPACKAGE_IDS.includes(applicationId)) {
    return 'geopackage';
  }
  if (applicationId === MBTILES_ID) {
    return 'mbtiles';
  }
  return extensionFormat(path) ?? 'sqlite';
}
