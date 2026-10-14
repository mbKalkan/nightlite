import type { HostToWebviewMessage, ViewerStrings, WebviewToHostMessage } from '../shared/protocol';
import { checkQuery } from '../shared/sqlCheck';
import { formatBytes, formatCount } from '../shared/units';
import { QUERY_MEMORY, QUERY_ROWS } from '../shared/values';
import { DataView, type DataMessage, type DataViewOptions } from './dataView';
import { newRun } from './runs';
import { databaseErrorMessage, element, format, messageView } from './views';

export type QueryPageMessage = Extract<
  HostToWebviewMessage,
  { type: 'queryProgress' | 'queryResult' | 'queryError' }
>;

export interface QueryPageEvents {
  send(message: WebviewToHostMessage): void;
  /** The statement as typed, to keep. */
  onSql(sql: string): void;
  /** How the results' grid and detail panel are to be shown, as the tables' are. */
  dataOptions(): DataViewOptions;
}

/**
 * The query page: a statement to type, Run and Stop, and the rows it returns in the same grid
 * tables show (D-021). Statements that could write are turned down here, before the host is
 * asked, and again there.
 */
export class QueryPage {
  readonly element: HTMLElement;
  private readonly editor: HTMLTextAreaElement;
  private readonly runButton: HTMLButtonElement;
  private readonly stopButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly results: HTMLElement;
  private run = 0;
  private running = false;
  private readonly exportButton: HTMLButtonElement;
  /** The statement whose rows are shown, to export them all, and the one last run. */
  private shownSql: string | undefined;
  private sentSql = '';
  /** The rows of the last query that returned some. */
  data: DataView | undefined;

  constructor(
    private readonly strings: ViewerStrings,
    private readonly locale: string,
    sql: string,
    private readonly events: QueryPageEvents,
  ) {
    this.element = element('div', 'nl-query');
    const bar = element('div', 'nl-query-bar');
    this.runButton = this.button(strings.runQuery, strings.runQueryHint, 'nl-button');
    this.runButton.addEventListener('click', () => this.start());
    this.stopButton = this.button(
      strings.stopQuery,
      strings.stopQueryHint,
      'nl-button nl-button-secondary',
    );
    this.stopButton.addEventListener('click', () => this.stop());
    this.stopButton.hidden = true;
    this.status = element('span', 'nl-query-status');
    this.status.setAttribute('role', 'status');
    this.exportButton = this.button(
      strings.exportRows,
      strings.exportHint,
      'nl-button nl-button-secondary nl-query-export',
    );
    this.exportButton.hidden = true;
    this.exportButton.addEventListener('click', () => this.exportRows());
    bar.append(this.runButton, this.stopButton, this.status, this.exportButton);

    this.editor = document.createElement('textarea');
    this.editor.className = 'nl-query-editor';
    this.editor.spellcheck = false;
    this.editor.value = sql;
    this.editor.placeholder = strings.queryPlaceholder;
    this.editor.setAttribute('aria-label', strings.queryStatement);
    this.editor.addEventListener('input', () => this.events.onSql(this.editor.value));
    this.element.addEventListener('keydown', (event) => this.onKey(event));

    this.results = element('div', 'nl-query-results');
    this.element.append(bar, this.editor, this.results);
  }

  focus(): void {
    this.editor.focus();
  }

  receive(message: QueryPageMessage): void {
    if (message.run !== this.run) return;
    const { strings, locale } = this;
    switch (message.type) {
      case 'queryProgress':
        this.status.textContent = `${strings.queryRunning} ${this.rowsText(message.rows)}`;
        return;
      case 'queryResult': {
        this.finish();
        this.data = new DataView('', strings, locale, (sent) => this.events.send(sent), {
          ...this.events.dataOptions(),
          results: { query: message.run, info: message.info, total: message.rows },
          empty: strings.queryNoRows,
        });
        this.results.replaceChildren(this.data.element);
        this.shownSql = this.sentSql;
        this.exportButton.hidden = false;
        const parts = [this.rowsText(message.rows), this.timeText(message.ms)];
        if (message.end === 'stopped') parts.unshift(strings.queryStoppedNote);
        this.status.textContent = parts.join(' · ');
        if (message.end === 'limit') {
          this.status.textContent += ` — ${format(
            strings.queryLimit,
            formatCount(message.rows, locale),
            formatCount(QUERY_ROWS, locale),
            formatBytes(QUERY_MEMORY, locale),
          )}`;
        }
        return;
      }
      case 'queryError':
        this.finish();
        this.status.textContent = '';
        if (message.reason === 'failed') {
          // SQLite's own words say best what's wrong with a statement, like a missing table.
          const error = message.error ?? 'other';
          this.results.replaceChildren(
            error === 'other'
              ? messageView(strings.queryErrorTitle, message.detail)
              : messageView(
                  strings.queryErrorTitle,
                  databaseErrorMessage(error, strings),
                  message.detail,
                ),
          );
        } else {
          this.refused(message.reason);
        }
        return;
    }
  }

  /** Asks the host to export every row of the statement shown, not only those kept here. */
  exportRows(): void {
    if (this.shownSql === undefined) return;
    this.events.send({ type: 'exportRows', source: { sql: this.shownSql }, name: 'query' });
  }

  /** Copy Reference for the results shown, named by their statement; false when there are none. */
  copyReference(withText: boolean): boolean {
    if (!this.data || this.shownSql === undefined) return false;
    this.data.copyReference(withText, { type: 'query', sql: this.shownSql });
    return true;
  }

  /** The grid's answers, for the rows on screen. */
  receiveData(message: DataMessage): void {
    this.data?.receive(message);
  }

  dispose(): void {
    if (this.running) this.events.send({ type: 'stopQuery', run: this.run });
    this.data?.dispose();
  }

  private start(): void {
    const sql = this.editor.value;
    const check = checkQuery(sql);
    if (this.running) this.events.send({ type: 'stopQuery', run: this.run });
    this.run = newRun();
    this.data?.dispose();
    this.data = undefined;
    this.shownSql = undefined;
    this.sentSql = sql;
    this.exportButton.hidden = true;
    if (!check.ok) {
      this.finish();
      this.status.textContent = '';
      this.refused(check.reason);
      return;
    }
    this.running = true;
    this.runButton.hidden = true;
    this.stopButton.hidden = false;
    this.status.textContent = this.strings.queryRunning;
    // Rows read so far change many times a second; screen readers hear the outcome only.
    this.status.setAttribute('aria-busy', 'true');
    this.results.setAttribute('aria-busy', 'true');
    this.results.replaceChildren(element('div', 'nl-progress'));
    this.events.send({ type: 'runQuery', run: this.run, sql });
  }

  private stop(): void {
    if (this.running) this.events.send({ type: 'stopQuery', run: this.run });
  }

  private finish(): void {
    const focused = this.element.contains(document.activeElement);
    this.running = false;
    this.runButton.hidden = false;
    this.stopButton.hidden = true;
    this.status.removeAttribute('aria-busy');
    this.results.removeAttribute('aria-busy');
    // Stop went away under the keyboard; Run takes its place.
    if (focused && document.activeElement === document.body) this.runButton.focus();
  }

  private refused(reason: 'empty' | 'several' | 'writes' | 'stopped'): void {
    const { strings } = this;
    const text = {
      empty: strings.queryEmpty,
      several: strings.querySeveral,
      writes: strings.queryWrites,
      stopped: strings.queryStopped,
    }[reason];
    if (reason === 'stopped') {
      this.showMessage(strings.queryStoppedNote, text);
    } else {
      this.showMessage(strings.queryErrorTitle, text);
    }
  }

  private showMessage(title: string, text: string): void {
    this.results.replaceChildren(messageView(title, text));
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.start();
    } else if (event.key === 'Escape' && this.running) {
      event.preventDefault();
      this.stop();
    }
  }

  private button(label: string, hint: string, className: string): HTMLButtonElement {
    const button = element('button', className, label) as HTMLButtonElement;
    button.type = 'button';
    button.title = hint;
    return button;
  }

  private rowsText(rows: number): string {
    return rows === 1
      ? this.strings.oneRow
      : format(this.strings.rowCount, formatCount(rows, this.locale));
  }

  private timeText(ms: number): string {
    if (ms < 1000) return format(this.strings.milliseconds, String(ms));
    const seconds = new Intl.NumberFormat(this.locale, { maximumFractionDigits: 1 }).format(
      ms / 1000,
    );
    return format(this.strings.seconds, seconds);
  }
}
