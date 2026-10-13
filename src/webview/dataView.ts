import type { HostToWebviewMessage, ViewerStrings, WebviewToHostMessage } from '../shared/protocol';
import { formatCount } from '../shared/units';
import { DataGrid } from './grid/dataGrid';
import { databaseErrorMessage, element, format } from './views';

type DataMessage = Extract<
  HostToWebviewMessage,
  { type: 'objectInfo' | 'rowCount' | 'rowPage' | 'objectError' }
>;

let nextRequest = 1;

/**
 * A table's or view's rows: asks the extension host for the columns, then rows as the grid
 * scrolls, and shows the row and column counts below. Answers for another object, or for
 * requests made before this view, are ignored.
 */
export class DataView {
  readonly element: HTMLElement;
  private readonly status: HTMLElement;
  private grid: DataGrid | undefined;
  private readonly requests = new Set<number>();
  private columns = 0;
  private estimated = false;

  constructor(
    readonly name: string,
    private readonly strings: ViewerStrings,
    private readonly locale: string,
    private readonly send: (message: WebviewToHostMessage) => void,
  ) {
    this.element = element('div', 'nl-data');
    this.status = element('div', 'nl-footer');
    this.status.setAttribute('aria-live', 'polite');
    this.element.append(element('div', 'nl-progress'), this.status);
    send({ type: 'openObject', name });
  }

  receive(message: DataMessage): void {
    if (
      message.type === 'objectInfo' ? message.info.name !== this.name : message.name !== this.name
    ) {
      return;
    }
    switch (message.type) {
      case 'objectInfo':
        if (this.grid) return;
        this.columns = message.info.columns.length;
        this.estimated = message.info.estimate !== null;
        this.grid = new DataGrid(
          message.info,
          this.strings,
          this.locale,
          (start, count, total) => {
            const request = nextRequest++;
            this.requests.add(request);
            this.send({ type: 'rows', request, name: this.name, start, count, total });
          },
          (total, exact) => this.showCounts(total, exact),
        );
        this.element.replaceChildren(this.grid.element, this.status);
        this.showCounts(message.info.estimate ?? 0, false);
        break;
      case 'rowCount':
        this.grid?.setTotal(message.count, true);
        break;
      case 'rowPage':
        if (this.requests.delete(message.request)) {
          this.grid?.receive(message.page);
        }
        break;
      case 'objectError': {
        if (message.request !== undefined && !this.requests.delete(message.request)) return;
        const text = databaseErrorMessage(message.error, this.strings);
        if (this.grid) {
          this.grid.fail(this.strings.rowsErrorTitle, `${text} ${message.detail}`);
        } else {
          const box = element('div', 'nl-grid-message');
          box.setAttribute('role', 'alert');
          box.append(
            element('strong', '', this.strings.rowsErrorTitle),
            element('span', '', text),
            element('span', 'nl-error-detail', message.detail),
          );
          this.element.replaceChildren(box);
        }
        break;
      }
    }
  }

  focus(): void {
    this.grid?.element.focus();
  }

  dispose(): void {
    this.grid?.dispose();
    this.element.remove();
  }

  private showCounts(total: number, exact: boolean): void {
    const count = formatCount(total, this.locale);
    let rows: string;
    if (exact) {
      rows = total === 1 ? this.strings.oneRow : format(this.strings.rowCount, count);
    } else if (this.estimated && total > 0) {
      rows = `${format(this.strings.rowEstimate, count)} (${this.strings.counting})`;
    } else {
      rows = this.strings.counting;
    }
    this.status.textContent = `${rows} · ${format(this.strings.columnCount, String(this.columns))}`;
  }
}
