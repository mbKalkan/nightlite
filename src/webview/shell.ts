import type {
  DatabaseError,
  FileInfo,
  HostToWebviewMessage,
  LoadError,
  SchemaObject,
  ViewerStrings,
  WebviewToHostMessage,
} from '../shared/protocol';
import { DataView } from './dataView';
import type { GridPosition } from './grid/dataGrid';
import { icons } from './icons';
import { MbtilesView, countsComplete, type TilesState } from './mbtiles/summary';
import { detailsSections } from './schemaDetails';
import { ObjectTree, objectKey, type EntryKey } from './objectTree';
import { databaseErrorMessage, element, messageView, objectView, overviewView } from './views';

/** Which page of a table or view is shown: its rows or the statement that made it. */
export type PageTab = 'data' | 'schema';

export interface ShellEvents {
  /** The user picked another sidebar entry. */
  onSelect(key: EntryKey): void;
  /** The user switched between Data and Schema. */
  onTab(tab: PageTab): void;
  /** The user opened or closed the cell detail panel. */
  onDetail(open: boolean): void;
  /** The user resized the cell detail panel. */
  onDetailWidth(width: number): void;
  send(message: WebviewToHostMessage): void;
}

type DetailsMessage = Extract<
  HostToWebviewMessage,
  { type: 'objectDetails' | 'objectDetailsError' }
>;

type TilesMessage = Extract<
  HostToWebviewMessage,
  { type: 'mbtiles' | 'mbtilesError' | 'zoomRange' | 'zoomCount' | 'zoomCountsEnd' }
>;

type DataMessage = Extract<
  HostToWebviewMessage,
  { type: 'objectInfo' | 'rowCount' | 'rowPage' | 'objectError' | 'copied' | 'cellValue' }
>;

/** The viewer's frame: the file name on top, the database's objects on the left, content right. */
export class Shell {
  private readonly fileName: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly detailToggle: HTMLElement;
  private readonly sidebar: HTMLElement;
  private readonly content: HTMLElement;
  private file: { info: FileInfo; locale: string; strings: ViewerStrings } | undefined;
  private objects = new Map<EntryKey, SchemaObject>();
  private tree: ObjectTree | undefined;
  private schemaError: { error: DatabaseError; detail: string } | undefined;
  private shown: EntryKey = 'overview';
  private data: DataView | undefined;
  /** An MBTiles file's summary, kept while other pages are shown. */
  private tiles: TilesState | undefined;
  private summary: MbtilesView | undefined;
  /** Objects' columns, indexes and foreign keys, by name, as the host sent them. */
  private details = new Map<string, DetailsMessage>();
  /** Where each table's grid was, so coming back to it, or reloading, returns there. */
  private readonly positions = new Map<string, GridPosition>();
  private tab: PageTab;
  private detail: boolean;
  private detailWidth: number | undefined;

  constructor(
    root: HTMLElement,
    private readonly events: ShellEvents,
    initial: { tab: PageTab; detail: boolean; detailWidth?: number },
  ) {
    this.tab = initial.tab;
    this.detail = initial.detail;
    this.detailWidth = initial.detailWidth;
    root.innerHTML = `
      <div class="nl-shell">
        <header class="nl-toolbar">
          <span class="nl-file-name"></span>
          <div class="nl-tabs" role="tablist" hidden>
            <button type="button" class="nl-tab" role="tab" data-tab="data"></button>
            <button type="button" class="nl-tab" role="tab" data-tab="schema"></button>
          </div>
          <button type="button" class="nl-icon-button nl-detail-toggle" hidden>${icons.panelRight}</button>
        </header>
        <div class="nl-body">
          <nav class="nl-sidebar" hidden></nav>
          <main class="nl-content" tabindex="-1"></main>
        </div>
      </div>`;
    this.fileName = root.querySelector('.nl-file-name') as HTMLElement;
    this.tabs = root.querySelector('.nl-tabs') as HTMLElement;
    this.detailToggle = root.querySelector('.nl-detail-toggle') as HTMLElement;
    this.detailToggle.addEventListener('click', () => this.data?.setDetail(!this.detail));
    this.sidebar = root.querySelector('.nl-sidebar') as HTMLElement;
    this.content = root.querySelector('.nl-content') as HTMLElement;
    this.tabs.addEventListener('click', (event) => {
      const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab;
      if (tab) this.setTab(tab as PageTab, false);
    });
    this.tabs.addEventListener('keydown', (event) => this.onTabKey(event));
  }

  /** A thin progress bar, as VS Code shows above a loading view. Strings arrive with the file. */
  showLoading(): void {
    this.content.setAttribute('aria-busy', 'true');
    this.content.replaceChildren(element('div', 'nl-progress'));
  }

  showFile(info: FileInfo, locale: string, strings: ViewerStrings): void {
    // The same file loaded again, after it changed: keep the page up until the schema is back.
    const reloading = this.file !== undefined && this.tree !== undefined;
    this.file = { info, locale, strings };
    this.tiles = undefined;
    this.setFileName(info.fileName);
    this.sidebar.setAttribute('aria-label', strings.databaseObjects);
    this.tabs.setAttribute('aria-label', strings.pageTabs);
    for (const button of this.tabs.querySelectorAll<HTMLElement>('[data-tab]')) {
      button.textContent = button.dataset.tab === 'data' ? strings.data : strings.schema;
    }
    this.detailToggle.title = strings.cellDetail;
    this.detailToggle.setAttribute('aria-label', strings.cellDetail);
    this.markDetail();
    if (!reloading) this.show('overview');
    // Until the schema arrives the database is still opening.
    this.content.setAttribute('aria-busy', 'true');
  }

  /** Lists the objects and shows `selected` if the database still has it, else the overview. */
  showSchema(objects: SchemaObject[], selected: EntryKey | undefined): void {
    if (!this.file) return;
    const { strings } = this.file;
    this.schemaError = undefined;
    this.objects = new Map(objects.map((object) => [objectKey(object), object]));
    this.details.clear();
    this.tree = new ObjectTree(objects, strings, (key) => {
      this.show(key);
      this.events.onSelect(key);
    });
    const parts: HTMLElement[] = [this.tree.element];
    if (!objects.some((object) => object.type === 'table')) {
      parts.push(element('p', 'nl-sidebar-note', strings.noTables));
    }
    this.sidebar.replaceChildren(...parts);
    this.sidebar.hidden = false;
    this.content.removeAttribute('aria-busy');
    this.tree.select(selected && this.tree.has(selected) ? selected : 'overview');
  }

  /** The header was readable but the database wasn't: say why below the header's facts. */
  showSchemaError(error: DatabaseError, detail: string): void {
    this.schemaError = { error, detail };
    this.sidebar.hidden = true;
    this.content.removeAttribute('aria-busy');
    this.show('overview');
  }

  showError(fileName: string, error: LoadError, strings: ViewerStrings): void {
    this.setFileName(fileName);
    this.data?.dispose();
    this.data = undefined;
    this.summary = undefined;
    // A file that can't be shown starts afresh once it can be again.
    this.file = undefined;
    this.tree = undefined;
    this.sidebar.hidden = true;
    this.tabs.hidden = true;
    this.detailToggle.hidden = true;
    const messages: Record<LoadError, string> = {
      empty: strings.errorEmpty,
      notSqlite: strings.errorNotSqlite,
      unreadable: strings.errorUnreadable,
      notOnDisk: strings.errorNotOnDisk,
    };
    this.content.removeAttribute('aria-busy');
    const box = messageView(strings.errorTitle, messages[error]);
    // A .db file can be anything; let the user pick another editor for it.
    if (error !== 'notOnDisk') {
      const button = element('button', 'nl-button', strings.reopenWith);
      button.setAttribute('type', 'button');
      button.addEventListener('click', () => this.events.send({ type: 'reopenWith' }));
      box.append(button);
    }
    this.content.replaceChildren(box);
  }

  /** Shows an object picked elsewhere, like Go to Table, and puts the keyboard on it. */
  reveal(name: string): void {
    const object = [...this.objects.values()].find((candidate) => candidate.name === name);
    if (object) {
      this.tree?.select(objectKey(object), true);
    }
  }

  /** An object's columns, indexes and foreign keys, for its Schema page. */
  detailsMessage(message: DetailsMessage): void {
    this.details.set(message.name, message);
    this.showDetails(message);
  }

  /** The host's answers about an MBTiles file, kept and shown when its summary is. */
  tilesMessage(message: TilesMessage): void {
    const tiles = this.tiles;
    if (!tiles) return;
    switch (message.type) {
      case 'mbtiles':
        tiles.summary = message.summary;
        this.summary?.render();
        this.countZooms();
        return;
      case 'mbtilesError':
        tiles.error = { error: message.error, detail: message.detail };
        this.summary?.render();
        return;
      case 'zoomRange':
        tiles.range = message.range;
        break;
      case 'zoomCount':
        tiles.counts.set(message.zoom, message.count);
        break;
      case 'zoomCountsEnd':
        tiles.counting = false;
        // Stopped while shown means it failed; stopped for a table's count, it resumes here.
        tiles.failed = !message.complete && this.summary !== undefined;
        break;
    }
    this.summary?.renderZooms();
  }

  /** Hands the host's answers about tables and views to the rows on screen. */
  dataMessage(message: DataMessage): void {
    this.data?.receive(message);
  }

  private show(key: EntryKey): void {
    if (!this.file) return;
    this.shown = key;
    const position = this.data?.position();
    if (this.data && position) this.positions.set(this.data.name, position);
    this.data?.dispose();
    this.data = undefined;
    this.summary = undefined;
    const { info, locale, strings } = this.file;
    const object = this.objects.get(key);
    const hasRows = object?.type === 'table' || object?.type === 'view';
    this.tabs.hidden = !hasRows;
    this.markTab();
    // On the Schema tab the toggle keeps its place, so the tabs don't move under the mouse.
    this.detailToggle.hidden = !hasRows;
    this.detailToggle.classList.toggle('nl-invisible', this.tab !== 'data');
    if (object && hasRows && this.tab === 'data') {
      this.data = new DataView(
        object.name,
        strings,
        locale,
        (message) => this.events.send(message),
        {
          detail: this.detail,
          onDetail: (open) => {
            this.detail = open;
            this.markDetail();
            this.events.onDetail(open);
          },
          detailWidth: this.detailWidth,
          position: this.positions.get(object.name),
          onDetailWidth: (width) => {
            this.detailWidth = width;
            this.events.onDetailWidth(width);
          },
        },
      );
      this.content.replaceChildren(this.data.element);
      return;
    }
    if (object) {
      this.content.replaceChildren(objectView(object, strings));
      const known = this.details.get(object.name);
      if (known) {
        this.showDetails(known);
      } else if (object.type !== 'trigger') {
        this.events.send({ type: 'objectDetails', name: object.name });
      }
      return;
    }
    if (info.format === 'mbtiles' && this.tree && !this.schemaError) {
      this.tiles ??= { counts: new Map(), counting: false, failed: false };
      this.summary = new MbtilesView(info, locale, strings, this.tiles);
      this.content.replaceChildren(this.summary.element);
      if (!this.tiles.summary && !this.tiles.error) {
        this.events.send({ type: 'mbtiles' });
      } else {
        this.countZooms();
      }
      return;
    }
    const parts: HTMLElement[] = [overviewView(info, locale, strings)];
    if (this.schemaError) {
      parts.push(
        messageView(
          strings.openErrorTitle,
          databaseErrorMessage(this.schemaError.error, strings),
          this.schemaError.detail,
        ),
      );
    }
    this.content.replaceChildren(...parts);
  }

  private showDetails(message: DetailsMessage): void {
    const strings = this.file?.strings;
    const shown = this.objects.get(this.shown);
    const place = this.content.querySelector('.nl-object-details');
    if (!strings || !place || shown?.name !== message.name) return;
    if (message.type === 'objectDetails') {
      place.replaceChildren(...detailsSections(message.details, strings));
    } else {
      place.replaceChildren(
        messageView(
          strings.detailsErrorTitle,
          databaseErrorMessage(message.error, strings),
          message.detail,
        ),
      );
    }
  }

  /** Counts tiles by zoom level while the summary is shown, picking up where it stopped. */
  private countZooms(): void {
    const tiles = this.tiles;
    if (!tiles?.summary?.tiles || !this.summary || tiles.counting || countsComplete(tiles)) {
      return;
    }
    tiles.counting = true;
    tiles.failed = false;
    this.summary.renderZooms();
    this.events.send({ type: 'zoomCounts', skip: [...tiles.counts.keys()] });
  }

  private setTab(tab: PageTab, focus: boolean): void {
    if (tab !== this.tab) {
      this.tab = tab;
      this.events.onTab(tab);
      this.show(this.shown);
    }
    if (focus) {
      this.tabs.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.focus();
    }
  }

  private markDetail(): void {
    this.detailToggle.setAttribute('aria-pressed', String(this.detail));
  }

  private markTab(): void {
    for (const button of this.tabs.querySelectorAll<HTMLElement>('[data-tab]')) {
      const selected = button.dataset.tab === this.tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  }

  /** Left and Right move between the tabs, as in any tab list. */
  private onTabKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    this.setTab(this.tab === 'data' ? 'schema' : 'data', true);
  }

  private setFileName(name: string): void {
    this.fileName.textContent = name;
    this.content.setAttribute('aria-label', name);
  }
}
