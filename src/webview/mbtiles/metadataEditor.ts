import { STANDARD_KEYS, checkMetadataValue, type MetadataIssue } from '../../shared/mbtiles';
import type {
  DatabaseError,
  MetadataEntry,
  MetadataState,
  ViewerStrings,
  WebviewToHostMessage,
} from '../../shared/protocol';
import { formatCount } from '../../shared/units';
import { icons } from '../icons';
import { databaseErrorMessage, element, format } from '../views';
import type { TilesState } from './summary';

/** Keys whose values run to paragraphs, edited in a box that grows. */
const LONG_KEYS = new Set(['description', 'attribution', 'json']);
/** Values the spec allows, offered as the user types. */
const SUGGESTIONS: Record<string, string[]> = {
  format: ['pbf', 'png', 'jpg', 'webp'],
  type: ['overlay', 'baselayer'],
};

type Field = HTMLInputElement | HTMLTextAreaElement;

interface Row {
  element: HTMLElement;
  field: Field;
  issues: HTMLElement;
}

/**
 * An MBTiles file's metadata as a form (D-005). Every keystroke goes to the extension host, which
 * keeps the changes until the file is saved: the first keystroke in a field starts an edit VS Code
 * can undo, the rest amend it. Values are checked against the MBTiles 1.3 spec as they're typed,
 * and zoom levels against the tiles; neither stops a save.
 */
export class MetadataEditor {
  readonly element: HTMLElement;
  private readonly note: HTMLElement;
  private readonly list: HTMLElement;
  private readonly adder: HTMLElement;
  private readonly newKey: HTMLInputElement;
  private readonly keys: HTMLDataListElement;
  private readonly rows = new Map<string, Row>();
  private entries: MetadataEntry[] = [];
  /**
   * Values typed here and not yet heard back, by key, oldest first: states come back one per
   * keystroke, behind the typing, and must not undo what was typed since.
   */
  private readonly sent = new Map<string, string[]>();
  /** The key being typed into since it got the keyboard; its keystrokes amend one edit. */
  private typing: string | undefined;
  /** A key just added, to put the keyboard in once it's listed. */
  private added: string | undefined;

  constructor(
    private readonly strings: ViewerStrings,
    private readonly locale: string,
    private readonly tiles: TilesState,
    private readonly send: (message: WebviewToHostMessage) => void,
  ) {
    this.element = element('section', 'nl-page nl-metadata');
    this.element.append(element('h1', 'nl-title', strings.metadataHeading));
    this.note = element('p', 'nl-note nl-metadata-note');
    this.list = element('div', 'nl-metadata-list');
    this.adder = element('div', 'nl-metadata-add');
    this.newKey = document.createElement('input');
    this.newKey.className = 'nl-input nl-metadata-new';
    this.newKey.spellcheck = false;
    this.newKey.placeholder = strings.newKey;
    this.newKey.setAttribute('aria-label', strings.newKey);
    this.newKey.setAttribute('list', 'nl-metadata-keys');
    this.keys = document.createElement('datalist');
    this.keys.id = 'nl-metadata-keys';
    const add = element('button', 'nl-button nl-button-secondary', strings.addKey);
    add.setAttribute('type', 'button');
    add.addEventListener('click', () => this.addKey());
    this.newKey.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.addKey();
      }
    });
    this.adder.append(this.newKey, this.keys, add);
    this.element.append(this.note, this.list, this.adder);
    this.list.append(element('div', 'nl-progress'));
    this.adder.hidden = true;
  }

  receive(state: MetadataState): void {
    if (state.readOnly) {
      this.note.textContent =
        state.readOnly === 'view' ? this.strings.metadataIsView : this.strings.metadataNoTable;
      this.list.replaceChildren();
      this.rows.clear();
      this.adder.hidden = true;
      return;
    }
    this.note.textContent = this.strings.metadataHint;
    this.adder.hidden = false;
    this.entries = state.entries;
    const names = new Set(state.entries.map((entry) => entry.name));
    for (const [name, row] of this.rows) {
      if (!names.has(name)) {
        row.element.remove();
        this.rows.delete(name);
      }
    }
    this.list.querySelector(':scope > .nl-progress')?.remove();
    state.entries.forEach((entry, index) => {
      let row = this.rows.get(entry.name);
      if (!row) {
        row = this.row(entry);
        this.rows.set(entry.name, row);
      }
      // Kept in the file's order, new keys at the end. A row is moved only when out of place:
      // moving the one being typed in would take the keyboard away from it.
      const place = this.list.children[index] ?? null;
      if (place !== row.element) this.list.insertBefore(row.element, place);
      this.update(row, entry);
    });
    this.keys.replaceChildren(
      ...STANDARD_KEYS.filter((key) => !names.has(key)).map((key) => {
        const option = document.createElement('option');
        option.value = key;
        return option;
      }),
    );
    const added = this.added && this.rows.get(this.added);
    if (added) {
      this.added = undefined;
      added.field.focus();
    }
    this.refreshIssues();
  }

  fail(error: DatabaseError, detail: string): void {
    this.list.replaceChildren(
      element('p', 'nl-warning', this.strings.mbtilesErrorTitle),
      element('p', 'nl-note', `${databaseErrorMessage(error, this.strings)} ${detail}`),
    );
    this.rows.clear();
    this.adder.hidden = true;
  }

  /** The tiles' zoom range arrived or changed: zoom levels are checked against it. */
  refreshIssues(): void {
    for (const [name, row] of this.rows) {
      const entry = this.entries.find((candidate) => candidate.name === name);
      if (entry) this.showIssues(row, entry);
    }
  }

  private row(entry: MetadataEntry): Row {
    const { strings } = this;
    const id = `nl-meta-${[...entry.name].map((c) => c.charCodeAt(0).toString(16)).join('')}`;
    const rowElement = element('div', 'nl-metadata-row');
    const label = element('label', 'nl-metadata-key', entry.name) as HTMLLabelElement;
    label.htmlFor = id;
    const long = LONG_KEYS.has(entry.name);
    const field: Field = document.createElement(long ? 'textarea' : 'input');
    field.id = id;
    field.className = `nl-input nl-metadata-value${entry.name === 'json' ? ' nl-metadata-code' : ''}`;
    field.spellcheck = false;
    if (field instanceof HTMLTextAreaElement) field.rows = 1;
    const suggestions = SUGGESTIONS[entry.name];
    if (suggestions && field instanceof HTMLInputElement) {
      const list = document.createElement('datalist');
      list.id = `${id}-values`;
      list.append(
        ...suggestions.map((value) => {
          const option = document.createElement('option');
          option.value = value;
          return option;
        }),
      );
      field.setAttribute('list', list.id);
      rowElement.append(list);
    }
    const issues = element('div', 'nl-metadata-issues');
    issues.id = `${id}-issues`;
    field.setAttribute('aria-describedby', issues.id);
    const box = element('div', 'nl-metadata-field');
    box.append(field, issues);
    const remove = element('button', 'nl-icon-button nl-metadata-remove') as HTMLButtonElement;
    remove.type = 'button';
    remove.innerHTML = icons.close;
    remove.title = format(strings.removeKey, entry.name);
    remove.setAttribute('aria-label', format(strings.removeKey, entry.name));
    remove.addEventListener('click', () => {
      this.typing = undefined;
      this.send({ type: 'editMetadata', name: entry.name, value: null });
    });
    rowElement.append(label, box, remove);
    const row: Row = { element: rowElement, field, issues };

    field.addEventListener('focus', () => (this.typing = undefined));
    field.addEventListener('input', () => {
      const amend = this.typing === entry.name;
      this.typing = entry.name;
      this.sent.set(entry.name, [...(this.sent.get(entry.name) ?? []), field.value]);
      this.send({ type: 'editMetadata', name: entry.name, value: field.value, amend });
      this.grow(field);
      const current = this.entries.find((candidate) => candidate.name === entry.name);
      if (current) this.showIssues(row, { ...current, value: field.value });
    });
    field.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') field.blur();
    });
    return row;
  }

  private update(row: Row, entry: MetadataEntry): void {
    const { field } = row;
    row.element.classList.toggle('nl-changed', entry.changed);
    row.element.title = entry.changed ? this.strings.changedKey : '';
    const sent = this.sent.get(entry.name) ?? [];
    const echo = sent.indexOf(entry.value);
    if (echo >= 0) {
      // A value typed here coming back: the field already has it, or what was typed since.
      sent.splice(0, echo + 1);
    } else {
      // Anything else, like an undo or another editor's change, is shown.
      this.sent.delete(entry.name);
      if (field.value !== entry.value) field.value = entry.value;
    }
    field.readOnly = entry.cutFrom !== undefined;
    this.grow(field);
    this.showIssues(row, entry);
  }

  private showIssues(row: Row, entry: MetadataEntry): void {
    const { strings, locale } = this;
    const notes: [string, 'error' | 'note'][] = [];
    const issue = checkMetadataValue(entry.name, entry.value);
    if (issue) notes.push([this.issueText(issue), 'error']);
    if (!issue && (entry.name === 'minzoom' || entry.name === 'maxzoom')) {
      const zoom = Number(entry.value);
      const other = this.entries.find(
        (candidate) => candidate.name === (entry.name === 'minzoom' ? 'maxzoom' : 'minzoom'),
      );
      const otherZoom =
        other && !checkMetadataValue(other.name, other.value) && Number(other.value);
      if (typeof otherZoom === 'number') {
        const [min, max] = entry.name === 'minzoom' ? [zoom, otherZoom] : [otherZoom, zoom];
        if (min > max) notes.push([strings.zoomOrder, 'error']);
      }
      const range = this.tiles.range;
      if (range) {
        const actual = entry.name === 'minzoom' ? range.min : range.max;
        if (zoom !== actual) {
          const template =
            entry.name === 'minzoom' ? strings.minzoomMismatch : strings.maxzoomMismatch;
          notes.push([format(template, String(zoom), String(actual)), 'note']);
        }
      }
    }
    if (entry.copies > 1) {
      notes.push([format(strings.keyCopies, formatCount(entry.copies, locale)), 'note']);
    }
    if (entry.cutFrom !== undefined) {
      notes.push([format(strings.valueTooLong, formatCount(entry.cutFrom, locale)), 'note']);
    }
    row.field.setAttribute('aria-invalid', String(notes.some(([, kind]) => kind === 'error')));
    row.issues.replaceChildren(
      ...notes.map(([text, kind]) =>
        element('p', kind === 'error' ? 'nl-metadata-issue' : 'nl-metadata-hint', text),
      ),
    );
  }

  private issueText(issue: MetadataIssue): string {
    const { strings } = this;
    return {
      format: strings.issueFormat,
      bounds: strings.issueBounds,
      center: strings.issueCenter,
      zoom: strings.issueZoom,
      type: strings.issueType,
      json: strings.issueJson,
    }[issue];
  }

  /** Adds the key typed, empty, and puts the keyboard in it; a key there already gets it now. */
  private addKey(): void {
    const name = this.newKey.value.trim();
    if (!name) return;
    this.newKey.value = '';
    const existing = this.rows.get(name);
    if (existing) {
      existing.field.focus();
      return;
    }
    this.added = name;
    this.send({ type: 'editMetadata', name, value: '' });
  }

  /** Grows a box with its text, up to a limit, as VS Code's own text areas do. */
  private grow(field: Field): void {
    if (!(field instanceof HTMLTextAreaElement)) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight + 2, 320)}px`;
  }
}
