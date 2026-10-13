import type { FullCell, ViewerStrings } from '../../shared/protocol';
import { formatBytes, formatCount } from '../../shared/units';
import { DETAIL_BYTES } from '../../shared/values';
import { STORAGE_CLASSES, blobKind, escapeHtml } from '../grid/cells';
import { icons } from '../icons';
import { element, format } from '../views';
import { formatJson, hexDump } from './format';

/** Where a cell is: its column, and its row as the row header names it, once known. */
export interface CellPlace {
  column: string;
  row: string | undefined;
}

export interface DetailActions {
  copy(): void;
  close(): void;
  /** Escape: back to the grid. */
  leave(): void;
  /** The panel was dragged or keyed to a new width, in pixels. */
  resized(width: number): void;
}

/** The narrowest the panel gets, and the least it leaves the grid. */
const MIN_WIDTH = 200;
/** One arrow key press on the sash. */
const KEY_STEP = 20;

/**
 * The selected cell in full beside the grid: JSON indented and colored, long text wrapped,
 * BLOBs as a hex dump of their first bytes. Its body takes focus so the keyboard can scroll it
 * and select text in it. A sash on its left edge resizes it, by mouse or arrow keys.
 */
export class CellDetail {
  readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly place: HTMLElement;
  private readonly facts: HTMLElement;
  private readonly note: HTMLElement;
  private readonly body: HTMLElement;
  private readonly copyButton: HTMLButtonElement;

  constructor(
    private readonly strings: ViewerStrings,
    private readonly locale: string,
    private readonly actions: DetailActions,
    width: number | undefined,
  ) {
    this.element = element('aside', 'nl-detail');
    this.element.setAttribute('aria-label', strings.cellDetail);
    if (width) this.element.style.flexBasis = `${width}px`;
    this.element.innerHTML = `
      <div class="nl-detail-sash" role="separator" aria-orientation="vertical" tabindex="0"></div>
      <div class="nl-detail-head">
        <div class="nl-detail-heading">
          <strong class="nl-detail-title"></strong>
          <span class="nl-detail-place"></span>
        </div>
        <button type="button" class="nl-icon-button" data-action="copy">${icons.copy}</button>
        <button type="button" class="nl-icon-button" data-action="close">${icons.close}</button>
      </div>
      <div class="nl-detail-facts"></div>
      <div class="nl-detail-note"></div>
      <div class="nl-detail-body" tabindex="0"></div>`;
    const find = (selector: string) => this.element.querySelector(selector) as HTMLElement;
    this.title = find('.nl-detail-title');
    this.place = find('.nl-detail-place');
    this.facts = find('.nl-detail-facts');
    this.note = find('.nl-detail-note');
    this.body = find('.nl-detail-body');
    this.body.setAttribute('aria-label', strings.cellDetail);
    this.copyButton = find('[data-action="copy"]') as HTMLButtonElement;
    const closeButton = find('[data-action="close"]');
    for (const [button, label] of [
      [this.copyButton, strings.copyValue],
      [closeButton, strings.close],
    ] as const) {
      button.title = label;
      button.setAttribute('aria-label', label);
    }
    this.copyButton.addEventListener('click', () => actions.copy());
    closeButton.addEventListener('click', () => actions.close());
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        actions.leave();
      }
    });
    this.setUpSash(find('.nl-detail-sash'));
  }

  /** No cell to show, as in an empty table. */
  clear(): void {
    this.setPlace(undefined);
    this.setFacts([]);
    this.note.textContent = '';
    this.body.replaceChildren(element('p', 'nl-detail-empty', this.strings.noCell));
    this.copyButton.disabled = true;
  }

  /** The cell's place while its value is on its way. */
  loading(place: CellPlace): void {
    this.setPlace(place);
    this.setFacts([]);
    this.note.textContent = '';
    this.body.setAttribute('aria-busy', 'true');
    this.body.replaceChildren(element('div', 'nl-progress'));
    this.copyButton.disabled = false;
  }

  show(place: CellPlace, cell: FullCell): void {
    this.setPlace(place);
    this.copyButton.disabled = false;
    this.body.removeAttribute('aria-busy');
    this.note.textContent = '';
    const type = STORAGE_CLASSES[cell.type] ?? '';
    switch (cell.type) {
      case 'n':
        this.setFacts([type]);
        this.body.replaceChildren(element('span', 'nl-null', 'NULL'));
        return;
      case 'i':
      case 'f':
        this.setFacts([type]);
        this.body.replaceChildren(element('pre', 'nl-detail-value', cell.text));
        return;
      case 'b': {
        const kind = blobKind(cell.text);
        this.setFacts([type, kind ?? '', formatBytes(cell.length, this.locale)]);
        if (cell.length > DETAIL_BYTES) {
          this.note.textContent = format(
            this.strings.showingBytes,
            formatBytes(DETAIL_BYTES, this.locale),
          );
        }
        this.body.replaceChildren(element('pre', 'nl-detail-hex', hexDump(cell.text)));
        return;
      }
      default: {
        this.setFacts([
          type,
          format(this.strings.characters, formatCount(cell.length, this.locale)),
        ]);
        const cut = cell.length > cell.text.length;
        if (cut) {
          this.note.textContent = format(
            this.strings.showingCharacters,
            formatCount(cell.text.length, this.locale),
          );
        }
        const json = cut ? undefined : formatJson(cell.text);
        const pre = element('pre', json ? 'nl-detail-json' : 'nl-detail-text');
        pre.innerHTML = json ?? escapeHtml(cell.text);
        this.body.replaceChildren(pre);
      }
    }
  }

  /** The value couldn't be read. */
  fail(place: CellPlace, title: string, detail: string): void {
    this.setPlace(place);
    this.setFacts([]);
    this.note.textContent = '';
    this.body.removeAttribute('aria-busy');
    const box = element('div', 'nl-detail-error');
    box.setAttribute('role', 'alert');
    box.append(element('strong', '', title), element('span', '', detail));
    this.body.replaceChildren(box);
  }

  focus(): void {
    this.body.focus();
  }

  private setUpSash(sash: HTMLElement): void {
    sash.setAttribute('aria-label', this.strings.resizeDetail);
    sash.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      sash.setPointerCapture(event.pointerId);
      sash.classList.add('nl-active');
      const startX = event.clientX;
      const startWidth = this.element.getBoundingClientRect().width;
      const move = (moved: PointerEvent) => this.resize(startWidth + startX - moved.clientX);
      const end = () => {
        sash.classList.remove('nl-active');
        sash.removeEventListener('pointermove', move);
        sash.removeEventListener('pointerup', end);
        sash.removeEventListener('pointercancel', end);
        this.actions.resized(Math.round(this.element.getBoundingClientRect().width));
      };
      sash.addEventListener('pointermove', move);
      sash.addEventListener('pointerup', end);
      sash.addEventListener('pointercancel', end);
    });
    sash.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const width = this.element.getBoundingClientRect().width;
      this.resize(width + (event.key === 'ArrowLeft' ? KEY_STEP : -KEY_STEP));
      this.actions.resized(Math.round(this.element.getBoundingClientRect().width));
    });
  }

  /** Widens or narrows the panel, leaving the grid room. */
  private resize(width: number): void {
    const room = this.element.parentElement?.getBoundingClientRect().width ?? Infinity;
    const clamped = Math.max(MIN_WIDTH, Math.min(width, room - MIN_WIDTH));
    this.element.style.flexBasis = `${Math.round(clamped)}px`;
  }

  private setPlace(place: CellPlace | undefined): void {
    this.title.textContent = place?.column ?? '';
    this.place.textContent = place?.row ?? '';
  }

  private setFacts(facts: string[]): void {
    this.facts.textContent = facts.filter(Boolean).join(' · ');
  }
}
