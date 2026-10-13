import type { DatabaseError, FileInfo, SchemaObject, ViewerStrings } from '../shared/protocol';
import { formatBytes, formatCount } from '../shared/units';
import { icons } from './icons';
import { highlightSql } from './sql';

/** The file's facts from its header: what kind of file, how big, how SQLite stores it. */
export function overviewView(file: FileInfo, locale: string, strings: ViewerStrings): HTMLElement {
  const { header } = file;
  const rows: [string, string][] = [
    [strings.fileSize, formatBytes(file.fileSize, locale)],
    [
      strings.pages,
      format(
        strings.pagesValue,
        formatCount(header.pageCount, locale),
        formatBytes(header.pageSize, locale),
      ),
    ],
    [strings.textEncoding, header.textEncoding],
    [strings.journal, header.wal ? strings.journalWal : strings.journalRollback],
  ];
  if (header.userVersion !== 0) {
    rows.push([strings.userVersion, formatCount(header.userVersion, locale)]);
  }
  if (header.applicationId !== 0) {
    rows.push([strings.applicationId, describeApplicationId(header.applicationId)]);
  }
  rows.push([strings.writtenBy, `SQLite ${header.sqliteVersion}`]);

  const list = element('dl', 'nl-facts');
  for (const [term, value] of rows) {
    list.append(element('dt', '', term), element('dd', '', value));
  }
  const section = element('section', 'nl-page nl-overview');
  section.append(element('h1', 'nl-title', formatName(file.format, strings)), list);
  return section;
}

/** A table, view, index or trigger: its kind, its traits and the statement that created it. */
export function objectView(object: SchemaObject, strings: ViewerStrings): HTMLElement {
  const section = element('section', 'nl-page nl-object');
  const title = element('h1', 'nl-title');
  const icon = element('span', 'nl-title-icon');
  icon.innerHTML = icons[object.type];
  title.append(icon, element('span', '', object.name));

  const traits = element('p', 'nl-traits');
  const kind = object.virtual ? strings.virtualTable : strings[object.type];
  traits.append(element('span', 'nl-trait', kind));
  if (object.tableName !== object.name) {
    traits.append(element('span', 'nl-trait', format(strings.onTable, object.tableName)));
  }
  for (const [present, label] of [
    [object.withoutRowid, strings.withoutRowid],
    [object.strict, strings.strict],
    [object.internal, strings.internalTable],
  ] as const) {
    if (present) {
      traits.append(element('span', 'nl-trait nl-trait-flag', label));
    }
  }

  // Columns, indexes and foreign keys arrive from the extension host into this.
  section.append(title, traits, element('div', 'nl-object-details'));
  const statement = element('section', 'nl-section');
  statement.append(element('h2', 'nl-heading', strings.statementHeading));
  if (object.sql) {
    const pre = element('pre', 'nl-sql');
    const code = element('code', '');
    code.innerHTML = highlightSql(object.sql);
    pre.append(code);
    statement.append(pre);
  } else {
    statement.append(element('p', 'nl-note', strings.noSql));
  }
  section.append(statement);
  return section;
}

/** A message in the middle of the content: why something can't be shown. */
export function messageView(title: string, message: string, detail?: string): HTMLElement {
  const box = element('div', 'nl-error');
  box.setAttribute('role', 'alert');
  box.append(element('h1', 'nl-error-title', title), element('p', 'nl-error-message', message));
  if (detail) {
    box.append(element('p', 'nl-error-detail', detail));
  }
  return box;
}

export function databaseErrorMessage(error: DatabaseError, strings: ViewerStrings): string {
  return {
    damaged: strings.openErrorDamaged,
    notSqlite: strings.errorNotSqlite,
    locked: strings.openErrorLocked,
    unreadable: strings.errorUnreadable,
    other: strings.openErrorOther,
  }[error];
}

function formatName(format: FileInfo['format'], strings: ViewerStrings): string {
  return {
    sqlite: strings.formatSqlite,
    mbtiles: strings.formatMbtiles,
    geopackage: strings.formatGeopackage,
  }[format];
}

/** Application IDs are usually four ASCII letters, like GPKG; show them as text when they are. */
function describeApplicationId(id: number): string {
  const hex = `0x${id.toString(16).padStart(8, '0')}`;
  const text = String.fromCharCode(id >>> 24, (id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff);
  return /^[\x20-\x7e]{4}$/.test(text) ? `${text} (${hex})` : hex;
}

export function format(template: string, ...values: string[]): string {
  return template.replace(/\{(\d+)\}/g, (match, index: string) => values[Number(index)] ?? match);
}

export function element(tag: string, className: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  if (text !== undefined) {
    el.textContent = text;
  }
  return el;
}
