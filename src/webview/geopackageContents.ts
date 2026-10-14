import type {
  DatabaseError,
  DatabaseHeader,
  GeoPackageContent,
  GeoPackageSummary,
  ViewerStrings,
} from '../shared/protocol';
import { formatCount } from '../shared/units';
import type { TablesState } from './databaseOverview';
import { databaseErrorMessage, element, format } from './views';

/** A GeoPackage's contents as read, kept while other pages are shown. */
export interface GeoPackageState {
  summary?: GeoPackageSummary;
  error?: { error: DatabaseError; detail: string };
}

/** The GeoPackage version the header says: GPKG with the version in user_version, or GP10, GP11. */
export function geopackageVersion(header: DatabaseHeader): string | undefined {
  switch (header.applicationId) {
    case 0x47504b47: {
      const version = header.userVersion;
      if (version <= 0) return undefined;
      const [major, minor, patch] = [
        Math.floor(version / 10000),
        Math.floor(version / 100) % 100,
        version % 100,
      ];
      return patch ? `${major}.${minor}.${patch}` : `${major}.${minor}`;
    }
    case 0x47503130:
      return '1.0';
    case 0x47503131:
      return '1.1';
    default:
      return undefined;
  }
}

/**
 * A GeoPackage's contents for its overview (D-024): each table it lists, of features, tiles or
 * attributes, with its geometry or zoom levels, its spatial reference system, rows and bounds;
 * then the extensions it uses.
 */
export function geopackageSection(
  state: GeoPackageState,
  header: DatabaseHeader,
  tables: TablesState,
  strings: ViewerStrings,
  locale: string,
  onOpen: (name: string) => void,
): HTMLElement {
  const section = element('section', 'nl-section nl-geopackage');
  const heading = element('h2', 'nl-heading', strings.contentsHeading);
  const version = geopackageVersion(header);
  if (version) {
    heading.append(
      ' ',
      element('span', 'nl-heading-note', format(strings.geopackageVersion, version)),
    );
  }
  section.append(heading);
  if (state.error) {
    section.append(
      element(
        'p',
        'nl-note',
        `${strings.geopackageErrorTitle}: ${databaseErrorMessage(state.error.error, strings)} ${state.error.detail}`,
      ),
    );
    return section;
  }
  const summary = state.summary;
  if (!summary) {
    section.append(element('p', 'nl-note', '…'));
    return section;
  }
  if (!summary.contents) {
    section.append(element('p', 'nl-note', strings.noContentsTable));
    return section;
  }
  if (summary.contents.length === 0) {
    section.append(element('p', 'nl-note', strings.noContents));
  } else {
    section.append(contentsTable(summary.contents, tables, strings, locale, onOpen));
  }
  if (summary.extensions.length > 0) {
    section.append(element('h2', 'nl-heading', strings.extensionsHeading));
    const list = element('ul', 'nl-extensions');
    for (const extension of summary.extensions) {
      const where = [extension.table, extension.column].filter(Boolean).join('.');
      list.append(
        element(
          'li',
          '',
          where ? format(strings.extensionOn, extension.name, where) : extension.name,
        ),
      );
    }
    section.append(list);
  }
  return section;
}

function contentsTable(
  contents: GeoPackageContent[],
  tables: TablesState,
  strings: ViewerStrings,
  locale: string,
  onOpen: (name: string) => void,
): HTMLElement {
  const table = element('div', 'nl-contents-table');
  table.setAttribute('role', 'table');
  const head = element('div', 'nl-contents-row nl-contents-head');
  head.setAttribute('role', 'row');
  for (const label of [
    strings.nameColumn,
    strings.kindColumn,
    strings.detailsColumn,
    strings.srsColumn,
    strings.rowsColumn,
    strings.boundsColumn,
  ]) {
    const cell = element('span', '', label);
    cell.setAttribute('role', 'columnheader');
    head.append(cell);
  }
  table.append(head);
  const number = new Intl.NumberFormat(locale, { maximumSignificantDigits: 7 });
  for (const content of contents) {
    const row = element('div', 'nl-contents-row');
    row.setAttribute('role', 'row');
    const name = element('span', 'nl-contents-name');
    const link = element('button', 'nl-link', content.identifier ?? content.table);
    link.setAttribute('type', 'button');
    link.addEventListener('click', () => onOpen(content.table));
    name.append(link);
    if (content.identifier && content.identifier !== content.table) {
      name.append(element('span', 'nl-contents-table-name', content.table));
    }
    if (content.description) name.title = content.description;
    const summary = tables.counts.get(content.table);
    const cells = [
      name,
      element('span', '', kindName(content.dataType, strings)),
      element('span', 'nl-contents-detail', details(content, strings)),
      srsCell(content, strings),
      element(
        'span',
        'nl-size-count',
        summary
          ? formatCount(summary.rows, locale)
          : summary === null
            ? '—'
            : tables.counting
              ? '…'
              : '',
      ),
      element(
        'span',
        'nl-contents-bounds',
        content.bounds
          ? `${number.format(content.bounds[0])}, ${number.format(content.bounds[1])} – ${number.format(content.bounds[2])}, ${number.format(content.bounds[3])}`
          : '',
      ),
    ];
    for (const cell of cells) cell.setAttribute('role', 'cell');
    row.append(...cells);
    table.append(row);
  }
  return table;
}

function kindName(dataType: string, strings: ViewerStrings): string {
  switch (dataType) {
    case 'features':
      return strings.featuresKind;
    case 'tiles':
      return strings.tilesKind;
    case 'attributes':
      return strings.attributesKind;
    default:
      return dataType;
  }
}

/** A feature table's geometry type and column, or a tile table's zoom levels. */
function details(content: GeoPackageContent, strings: ViewerStrings): string {
  if (content.geometry) {
    const { type, column, z, m } = content.geometry;
    // 1 means every geometry has Z (or M); 2, that some may.
    const dimensions = `${z === 1 ? 'Z' : ''}${m === 1 ? 'M' : ''}`;
    return `${type}${dimensions ? ` ${dimensions}` : ''} · ${column}`;
  }
  if (content.zooms) {
    const { min, max } = content.zooms;
    return format(strings.layerZoom, String(min), String(max));
  }
  return '';
}

/** The SRS as its authority's code, like EPSG:4326, with its name on hover. */
function srsCell(content: GeoPackageContent, strings: ViewerStrings): HTMLElement {
  const srs = content.srs;
  if (!srs) return element('span', '');
  const authority =
    srs.organization && srs.organization.toUpperCase() !== 'NONE' && srs.code !== null
      ? `${srs.organization.toUpperCase()}:${srs.code}`
      : undefined;
  const cell = element(
    'span',
    '',
    authority ?? (srs.id <= 0 ? strings.undefinedSrs : String(srs.id)),
  );
  if (srs.name) cell.title = srs.name;
  return cell;
}
