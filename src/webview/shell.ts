import type { FileInfo, LoadError, ViewerStrings } from '../shared/protocol';
import { formatBytes, formatCount } from '../shared/units';

/** The viewer's frame: a title bar with the file name and the content below it. */
export class Shell {
  private readonly fileName: HTMLElement;
  private readonly content: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="nl-shell">
        <header class="nl-toolbar">
          <span class="nl-file-name"></span>
        </header>
        <main class="nl-content" tabindex="-1"></main>
      </div>`;
    this.fileName = root.querySelector('.nl-file-name') as HTMLElement;
    this.content = root.querySelector('.nl-content') as HTMLElement;
  }

  /** A thin progress bar, as VS Code shows above a loading view. Strings arrive with the file. */
  showLoading(): void {
    this.content.setAttribute('aria-busy', 'true');
    this.content.replaceChildren(element('div', 'nl-progress'));
  }

  showFile(file: FileInfo, locale: string, strings: ViewerStrings): void {
    this.setFileName(file.fileName);
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

    const list = document.createElement('dl');
    list.className = 'nl-facts';
    for (const [term, value] of rows) {
      list.append(element('dt', '', term), element('dd', '', value));
    }
    const section = element('section', 'nl-overview');
    section.append(element('h1', 'nl-format', formatName(file.format, strings)), list);
    this.content.removeAttribute('aria-busy');
    this.content.replaceChildren(section);
  }

  showError(fileName: string, error: LoadError, strings: ViewerStrings): void {
    this.setFileName(fileName);
    const messages: Record<LoadError, string> = {
      empty: strings.errorEmpty,
      notSqlite: strings.errorNotSqlite,
      unreadable: strings.errorUnreadable,
      notOnDisk: strings.errorNotOnDisk,
    };
    const box = element('div', 'nl-error');
    box.setAttribute('role', 'alert');
    box.append(
      element('h1', 'nl-error-title', strings.errorTitle),
      element('p', 'nl-error-message', messages[error]),
    );
    this.content.removeAttribute('aria-busy');
    this.content.replaceChildren(box);
  }

  private setFileName(name: string): void {
    this.fileName.textContent = name;
    this.content.setAttribute('aria-label', name);
  }
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

function format(template: string, ...values: string[]): string {
  return template.replace(/\{(\d+)\}/g, (match, index: string) => values[Number(index)] ?? match);
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  if (text !== undefined) {
    el.textContent = text;
  }
  return el;
}
