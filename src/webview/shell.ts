import type {
  DatabaseError,
  FileInfo,
  HostToWebviewMessage,
  LoadError,
  SchemaObject,
  ViewerStrings,
  WebviewToHostMessage,
} from '../shared/protocol';
import { sqlBlock } from '../shared/reference';
import { isPlain, type RowView } from '../shared/rowFilter';
import { DataView, type DataViewOptions, type RunMessage } from './dataView';
import { DatabaseOverview, listedTables, type TablesState } from './databaseOverview';
import type { GeoPackageState } from './geopackageContents';
import type { GridPosition } from './grid/dataGrid';
import { icons } from './icons';
import { MbtilesView, countsComplete, type TilesState } from './mbtiles/summary';
import { MetadataEditor } from './mbtiles/metadataEditor';
import { TileBrowser, type TileMessage, type TileView } from './mbtiles/tileBrowser';
import { detailsSections } from './schemaDetails';
import { ObjectTree, objectKey, type EntryKey } from './objectTree';
import { QueryPage, type QueryPageMessage } from './queryPage';
import { sourceLocation, takeContextTarget, trackContextMenu } from './reference';
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
  /** The tile browser moved to another tile, or changed how it shows tiles. */
  onTileView(view: TileView): void;
  /** The statement on the query page changed. */
  onSql(sql: string): void;
  /** A table's rows were sorted or filtered otherwise; plain views are left out. */
  onViews(views: Record<string, RowView>): void;
  /** The row of column filters was shown or hidden. */
  onFilterRow(open: boolean): void;
  send(message: WebviewToHostMessage): void;
}

type DetailsMessage = Extract<
  HostToWebviewMessage,
  { type: 'objectDetails' | 'objectDetailsError' }
>;

type TablesMessage = Extract<HostToWebviewMessage, { type: 'tableSummary' | 'tableSummariesEnd' }>;

type TilesMessage = Extract<
  HostToWebviewMessage,
  { type: 'mbtiles' | 'mbtilesError' | 'zoomRange' | 'zoomCount' | 'zoomCountsEnd' }
>;

type DataMessage = Extract<
  HostToWebviewMessage,
  { type: 'objectInfo' | 'rowCount' | 'rowPage' | 'objectError' | 'copied' | 'cellValue' }
>;

/** Typing in the search box applies once it pauses; the view itself waits for that. */
type SearchKey = 'Enter' | 'Escape';

/** The viewer's frame: the file name on top, the database's objects on the left, content right. */
export class Shell {
  private readonly fileName: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly detailToggle: HTMLElement;
  private readonly search: HTMLElement;
  private readonly searchInput: HTMLInputElement;
  private readonly filterToggle: HTMLElement;
  private readonly exportButton: HTMLElement;
  /** How each table's rows are sorted and filtered, by name. */
  private readonly views: Map<string, RowView>;
  private filterRow: boolean;
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
  private browser: TileBrowser | undefined;
  private metadataEditor: MetadataEditor | undefined;
  private readonly tileView: TileView;
  /** A database's tables as counted for its overview, kept while other pages are shown. */
  private tables: TablesState | undefined;
  /** A GeoPackage's contents, kept likewise. */
  private geopackage: GeoPackageState | undefined;
  private overview: DatabaseOverview | undefined;
  /** Objects' columns, indexes and foreign keys, by name, as the host sent them. */
  private details = new Map<string, DetailsMessage>();
  /** Where each table's grid was, so coming back to it, or reloading, returns there. */
  private readonly positions = new Map<string, GridPosition>();
  private tab: PageTab;
  private detail: boolean;
  private detailWidth: number | undefined;
  /** The query page, kept with its statement and results while other pages are shown. */
  private queryPage: QueryPage | undefined;
  private sql: string | undefined;
  /** The table or view last shown, for the query page's first statement. */
  private lastObject: string | undefined;

  constructor(
    root: HTMLElement,
    private readonly events: ShellEvents,
    initial: {
      tab: PageTab;
      detail: boolean;
      detailWidth?: number;
      tileView: TileView;
      sql?: string;
      views?: Record<string, RowView>;
      filterRow?: boolean;
    },
  ) {
    this.sql = initial.sql;
    this.views = new Map(Object.entries(initial.views ?? {}));
    this.filterRow = initial.filterRow ?? false;
    this.tab = initial.tab;
    this.tileView = initial.tileView;
    this.detail = initial.detail;
    this.detailWidth = initial.detailWidth;
    root.innerHTML = `
      <div class="nl-shell">
        <header class="nl-toolbar">
          <span class="nl-file-name"></span>
          <div class="nl-search" hidden>
            ${icons.search}
            <input type="text" class="nl-search-input" spellcheck="false">
          </div>
          <div class="nl-tabs" role="tablist" hidden>
            <button type="button" class="nl-tab" role="tab" data-tab="data"></button>
            <button type="button" class="nl-tab" role="tab" data-tab="schema"></button>
          </div>
          <button type="button" class="nl-icon-button nl-filter-toggle" hidden>${icons.filter}</button>
          <button type="button" class="nl-icon-button nl-export" hidden>${icons.save}</button>
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
    this.detailToggle.addEventListener('click', () => this.shownData()?.setDetail(!this.detail));
    this.search = root.querySelector('.nl-search') as HTMLElement;
    this.searchInput = root.querySelector('.nl-search-input') as HTMLInputElement;
    this.searchInput.addEventListener('input', () => this.data?.setSearch(this.searchInput.value));
    this.searchInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      event.preventDefault();
      this.onSearchKey(event.key);
    });
    this.filterToggle = root.querySelector('.nl-filter-toggle') as HTMLElement;
    this.filterToggle.addEventListener('click', () => this.setFilterRow(!this.filterRow));
    this.exportButton = root.querySelector('.nl-export') as HTMLElement;
    this.exportButton.addEventListener('click', () => this.data?.exportRows());
    this.sidebar = root.querySelector('.nl-sidebar') as HTMLElement;
    this.content = root.querySelector('.nl-content') as HTMLElement;
    this.tabs.addEventListener('click', (event) => {
      const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab;
      if (tab) this.setTab(tab as PageTab, false);
    });
    this.tabs.addEventListener('keydown', (event) => this.onTabKey(event));
    trackContextMenu(root);
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
    this.tables = undefined;
    this.geopackage = undefined;
    this.setFileName(info.fileName);
    this.sidebar.setAttribute('aria-label', strings.databaseObjects);
    this.tabs.setAttribute('aria-label', strings.pageTabs);
    for (const button of this.tabs.querySelectorAll<HTMLElement>('[data-tab]')) {
      button.textContent = button.dataset.tab === 'data' ? strings.data : strings.schema;
    }
    this.detailToggle.title = strings.cellDetail;
    this.detailToggle.setAttribute('aria-label', strings.cellDetail);
    this.markDetail();
    this.searchInput.placeholder = strings.searchRows;
    this.searchInput.title = strings.searchHint;
    this.searchInput.setAttribute('aria-label', strings.searchRows);
    this.filterToggle.title = strings.filterByColumn;
    this.filterToggle.setAttribute('aria-label', strings.filterByColumn);
    this.exportButton.title = strings.exportHint;
    this.exportButton.setAttribute('aria-label', strings.exportRows);
    this.markFilterRow();
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
    this.tables = undefined;
    this.tree = new ObjectTree(
      objects,
      strings,
      (key) => {
        this.show(key);
        this.events.onSelect(key);
      },
      this.file.info.format === 'mbtiles',
    );
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
    this.browser?.dispose();
    this.browser = undefined;
    this.metadataEditor = undefined;
    this.overview = undefined;
    this.queryPage?.dispose();
    this.queryPage = undefined;
    // A file that can't be shown starts afresh once it can be again.
    this.file = undefined;
    this.tree = undefined;
    this.sidebar.hidden = true;
    this.tabs.hidden = true;
    this.detailToggle.hidden = true;
    this.search.hidden = true;
    this.filterToggle.hidden = true;
    this.exportButton.hidden = true;
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

  /** Copy or Copy as Markdown Table: the grid's selection, when a grid is in view. */
  copySelection(markdown: boolean): void {
    this.shownData()?.copySelection(markdown);
  }

  /**
   * Copy Reference (D-026): to the table, view, index or trigger right-clicked in the sidebar,
   * else to what's in view: the grid's selection, the object, the tile, or else the file alone.
   * With `withText`, what is there follows: the values, or the statement that made the object.
   */
  copyReference(withText: boolean): void {
    const item = takeContextTarget()?.closest<HTMLElement>('.nl-tree-item[data-key]');
    const clicked = item ? this.objects.get(item.dataset.key ?? '') : undefined;
    const shown = this.objects.get(this.shown);
    const object = clicked ?? shown;
    if (!clicked && this.shown === 'query') {
      if (this.queryPage?.copyReference(withText)) return;
    } else if (!clicked && this.data && (shown?.type === 'table' || shown?.type === 'view')) {
      this.data.copyReference(withText, { type: shown.type, name: shown.name });
      return;
    } else if (object && this.file) {
      this.events.send({
        type: 'reference',
        location: sourceLocation(object, this.file.strings),
        text: withText && object.sql ? sqlBlock(object.sql) : undefined,
      });
      return;
    }
    this.events.send({
      type: 'reference',
      location: this.shown === 'tiles' ? (this.browser?.reference() ?? '') : '',
    });
  }

  /** Shows the query page and puts the keyboard in its statement. */
  openQuery(): void {
    if (!this.tree?.has('query')) return;
    this.tree.select('query');
    this.queryPage?.focus();
  }

  /** How a run is getting on, its rows, or why there are none: a query's, or a table view's. */
  queryMessage(message: QueryPageMessage | RunMessage): void {
    this.queryPage?.receive(message);
    this.data?.receiveRun(message);
  }

  /** Export Rows…, from the Command Palette or the context menu: the rows on screen. */
  exportRows(): void {
    if (this.shown === 'query') this.queryPage?.exportRows();
    else this.data?.exportRows();
  }

  /** A GeoPackage's contents, or why they couldn't be read. */
  geopackageMessage(
    message: Extract<HostToWebviewMessage, { type: 'geopackage' | 'geopackageError' }>,
  ): void {
    if (!this.geopackage) return;
    if (message.type === 'geopackage') this.geopackage.summary = message.summary;
    else this.geopackage.error = { error: message.error, detail: message.detail };
    this.overview?.renderGeoPackage();
  }

  /** Sort Ascending, Sort Descending or Clear Sort, from the context menu. */
  sortRows(direction: 'ascending' | 'descending' | null): void {
    if (this.shown !== 'query') this.data?.sortActive(direction);
  }

  /** An object's columns, indexes and foreign keys, for its Schema page. */
  detailsMessage(message: DetailsMessage): void {
    this.details.set(message.name, message);
    this.showDetails(message);
  }

  /** Tables' sizes for the overview, kept and shown as they arrive. */
  tablesMessage(message: TablesMessage): void {
    const tables = this.tables;
    if (!tables) return;
    if (message.type === 'tableSummary') {
      tables.counts.set(message.name, message.summary);
    } else {
      tables.counting = false;
    }
    this.overview?.renderTables();
  }

  /** The host's answers about an MBTiles file, kept and shown when its summary or tiles are. */
  tilesMessage(message: TilesMessage): void {
    const tiles = this.tiles;
    if (!tiles) return;
    switch (message.type) {
      case 'mbtiles':
        tiles.summary = message.summary;
        this.summary?.render();
        this.browser?.update();
        this.countZooms();
        return;
      case 'mbtilesError':
        tiles.error = { error: message.error, detail: message.detail };
        this.summary?.render();
        this.browser?.update();
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
        tiles.failed =
          !message.complete && (this.summary !== undefined || this.browser !== undefined);
        break;
    }
    this.summary?.renderZooms();
    this.browser?.update();
    this.metadataEditor?.refreshIssues();
  }

  /** The metadata as edited, for the metadata page. */
  metadataMessage(
    message: Extract<HostToWebviewMessage, { type: 'metadataState' | 'metadataError' }>,
  ): void {
    if (message.type === 'metadataState') this.metadataEditor?.receive(message.state);
    else this.metadataEditor?.fail(message.error, message.detail);
  }

  /** The host's answers to the tile browser. */
  tileMessage(message: TileMessage): void {
    this.browser?.receive(message);
  }

  /** Hands the host's answers about tables, views and query results to the rows on screen. */
  dataMessage(message: DataMessage): void {
    // Each grid takes only the answers to its own questions.
    this.data?.receive(message);
    if ('query' in message && message.query !== undefined) this.queryPage?.receiveData(message);
  }

  private show(key: EntryKey): void {
    if (!this.file) return;
    this.shown = key;
    const position = this.data?.position();
    if (this.data && position) this.positions.set(this.data.name, position);
    this.data?.dispose();
    this.data = undefined;
    this.summary = undefined;
    this.browser?.dispose();
    this.browser = undefined;
    this.metadataEditor = undefined;
    this.overview = undefined;
    const { info, locale, strings } = this.file;
    const object = this.objects.get(key);
    const hasRows = object?.type === 'table' || object?.type === 'view';
    this.tabs.hidden = !hasRows;
    this.markTab();
    // On the Schema tab the toggle keeps its place, so the tabs don't move under the mouse.
    this.detailToggle.hidden = !hasRows && key !== 'query';
    this.detailToggle.classList.toggle('nl-invisible', hasRows && this.tab !== 'data');
    // Searching and filtering are for a table's rows; on its Schema tab they keep their place.
    this.search.hidden = !hasRows;
    this.search.classList.toggle('nl-invisible', this.tab !== 'data');
    this.filterToggle.hidden = !hasRows;
    this.filterToggle.classList.toggle('nl-invisible', this.tab !== 'data');
    this.exportButton.hidden = !hasRows;
    this.exportButton.classList.toggle('nl-invisible', this.tab !== 'data');
    if (hasRows) this.lastObject = object.name;
    if (object && hasRows && this.tab === 'data') {
      const name = object.name;
      const view = this.views.get(name);
      this.searchInput.value = view?.search ?? '';
      this.data = new DataView(name, strings, locale, (message) => this.events.send(message), {
        ...this.dataOptions(),
        position: this.positions.get(name),
        view,
        filters: this.filterRow,
        onView: (changed) => {
          if (isPlain(changed)) this.views.delete(name);
          else this.views.set(name, changed);
          this.events.onViews(Object.fromEntries(this.views));
          if (document.activeElement !== this.searchInput) this.searchInput.value = changed.search;
        },
        onFind: () => {
          this.searchInput.focus();
          this.searchInput.select();
        },
      });
      this.content.replaceChildren(this.data.element);
      return;
    }
    if (key === 'query' && this.tree && !this.schemaError) {
      this.queryPage ??= new QueryPage(strings, locale, this.sql ?? this.firstStatement(), {
        send: (message) => this.events.send(message),
        onSql: (sql) => {
          this.sql = sql;
          this.events.onSql(sql);
        },
        dataOptions: () => this.dataOptions(),
      });
      this.content.replaceChildren(this.queryPage.element);
      return;
    }
    if (object) {
      const page = objectView(object, strings);
      // The context menu offers Copy Reference for the object.
      page.dataset.vscodeContext = JSON.stringify({ webviewSection: 'object' });
      this.content.replaceChildren(page);
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
      if (key === 'metadata') {
        this.metadataEditor = new MetadataEditor(strings, locale, this.tiles, (message) =>
          this.events.send(message),
        );
        this.content.replaceChildren(this.metadataEditor.element);
        this.events.send({ type: 'metadata' });
      } else if (key === 'tiles') {
        this.browser = new TileBrowser(locale, strings, this.tiles, this.tileView, {
          send: (message) => this.events.send(message),
          onView: (view) => this.events.onTileView(view),
        });
        this.content.replaceChildren(this.browser.element);
      } else {
        this.summary = new MbtilesView(info, locale, strings, this.tiles, (zoom) => {
          this.tileView.tile = undefined;
          this.tileView.zoom = zoom;
          this.tree?.select('tiles', true);
        });
        this.content.replaceChildren(this.summary.element);
      }
      if (!this.tiles.summary && !this.tiles.error) {
        this.events.send({ type: 'mbtiles' });
      } else {
        this.countZooms();
      }
      return;
    }
    if (this.tree && !this.schemaError) {
      this.tables ??= { counts: new Map(), counting: false };
      const geopackage = info.format === 'geopackage';
      if (geopackage && !this.geopackage) {
        this.geopackage = {};
        this.events.send({ type: 'geopackage' });
      }
      this.overview = new DatabaseOverview(
        info,
        locale,
        strings,
        [...this.objects.values()],
        this.tables,
        (name) => this.reveal(name),
        geopackage ? this.geopackage : undefined,
      );
      this.content.replaceChildren(this.overview.element);
      this.countTables();
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

  /** How grids and their detail panels show, the same for every table, view and query. */
  private dataOptions(): DataViewOptions {
    return {
      detail: this.detail,
      onDetail: (open) => {
        this.detail = open;
        this.markDetail();
        this.events.onDetail(open);
      },
      detailWidth: this.detailWidth,
      onDetailWidth: (width) => {
        this.detailWidth = width;
        this.events.onDetailWidth(width);
      },
    };
  }

  /** The rows on screen: a table's or view's, or a query's results. */
  private shownData(): DataView | undefined {
    return this.shown === 'query' ? this.queryPage?.data : this.data;
  }

  /** The query page's first statement: the rows of the table last shown, or the first one. */
  private firstStatement(): string {
    const name =
      this.lastObject ??
      [...this.objects.values()].find((object) => object.type === 'table' && !object.internal)
        ?.name;
    return name === undefined ? '' : `SELECT * FROM "${name.replace(/"/g, '""')}" LIMIT 100;`;
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

  /** Counts the tables not counted yet while the overview is shown; a table's count stops it. */
  private countTables(): void {
    const tables = this.tables;
    if (!tables || !this.overview || tables.counting) return;
    const names = listedTables([...this.objects.values()]).filter(
      (name) => !tables.counts.has(name),
    );
    if (names.length === 0) return;
    tables.counting = true;
    this.overview.renderTables();
    this.events.send({ type: 'tableSummaries', names });
  }

  /** Counts tiles by zoom level while the summary or tiles are shown, from where it stopped. */
  private countZooms(): void {
    const tiles = this.tiles;
    const shown = this.summary ?? this.browser;
    if (!tiles?.summary?.tiles || !shown || tiles.counting || countsComplete(tiles)) {
      return;
    }
    tiles.counting = true;
    tiles.failed = false;
    this.summary?.renderZooms();
    this.browser?.update();
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

  private markFilterRow(): void {
    this.filterToggle.setAttribute('aria-pressed', String(this.filterRow));
  }

  /** Shows or hides the column filters of every table; hidden, they filter nothing. */
  private setFilterRow(open: boolean): void {
    this.filterRow = open;
    this.markFilterRow();
    this.events.onFilterRow(open);
    this.data?.setFilters(open);
    if (open) this.data?.focusFilter();
  }

  /** Enter applies the search at once; Escape clears it, or goes back to the rows. */
  private onSearchKey(key: SearchKey): void {
    if (key === 'Enter') {
      this.data?.setSearch(this.searchInput.value, true);
    } else if (this.searchInput.value) {
      this.searchInput.value = '';
      this.data?.setSearch('', true);
    } else {
      this.data?.focus();
    }
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
