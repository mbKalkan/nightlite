import type { ObjectType, SchemaObject, ViewerStrings } from '../shared/protocol';
import { icons } from './icons';

/** `overview`, `tiles`, `metadata`, `group:<type>` or `<type>:<name>`. */
export type EntryKey = string;

interface Entry {
  key: EntryKey;
  label: string;
  level: 1 | 2;
  icon: string;
  /** Groups show how many objects they hold, and collapse. */
  count?: number;
  muted?: boolean;
  title?: string;
}

const GROUPS: { type: ObjectType; label: keyof ViewerStrings }[] = [
  { type: 'table', label: 'tables' },
  { type: 'view', label: 'views' },
  { type: 'index', label: 'indexes' },
  { type: 'trigger', label: 'triggers' },
];

export const objectKey = (object: Pick<SchemaObject, 'type' | 'name'>): EntryKey =>
  `${object.type}:${object.name}`;

/**
 * The sidebar entries: Overview, the tile browser for tilesets, then one collapsible group per
 * kind of object that exists.
 */
function entriesFor(
  objects: readonly SchemaObject[],
  strings: ViewerStrings,
  tiles: boolean,
): Entry[] {
  const entries: Entry[] = [
    { key: 'overview', label: strings.overview, level: 1, icon: icons.database },
  ];
  if (tiles) {
    entries.push({ key: 'tiles', label: strings.tileBrowser, level: 1, icon: icons.tiles });
    entries.push({
      key: 'metadata',
      label: strings.metadataHeading,
      level: 1,
      icon: icons.metadata,
    });
  }
  for (const group of GROUPS) {
    // SQLite's own tables and the ones behind virtual tables come last, dimmed.
    const members = objects
      .filter((object) => object.type === group.type)
      .sort((a, b) => Number(a.internal) - Number(b.internal));
    if (members.length === 0) {
      continue;
    }
    entries.push({
      key: `group:${group.type}`,
      label: strings[group.label],
      level: 1,
      icon: icons.chevronDown,
      count: members.length,
    });
    for (const object of members) {
      entries.push({
        key: objectKey(object),
        label: object.name,
        level: 2,
        icon: icons[object.type],
        muted: object.internal,
        title:
          object.tableName !== object.name
            ? `${object.name} — ${strings.onTable.replace('{0}', object.tableName)}`
            : object.name,
      });
    }
  }
  return entries;
}

/**
 * The sidebar's list of database objects: a tree in the ARIA sense with one tab stop. Arrow keys
 * move through it and show what they land on, Left and Right fold groups, typing jumps to a name.
 */
export class ObjectTree {
  readonly element: HTMLElement;
  private readonly entries: Entry[];
  private readonly rows: HTMLElement[];
  private readonly collapsed = new Set<EntryKey>();
  private typed = '';
  private typedAt = 0;

  constructor(
    objects: readonly SchemaObject[],
    private readonly strings: ViewerStrings,
    private readonly onSelect: (key: EntryKey) => void,
    tiles = false,
  ) {
    this.entries = entriesFor(objects, strings, tiles);
    this.element = document.createElement('div');
    this.element.className = 'nl-tree';
    this.element.setAttribute('role', 'tree');
    this.element.setAttribute('aria-label', strings.databaseObjects);
    this.rows = this.entries.map((entry, index) => this.row(entry, index));
    this.element.append(...this.rows);
    this.element.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.layout();
  }

  has(key: EntryKey): boolean {
    return this.entries.some((entry) => entry.key === key && !this.isGroup(entry));
  }

  /** Marks an entry as the one shown, opening its group; `focus` also moves the keyboard there. */
  select(key: EntryKey, focus = false): void {
    const index = this.entries.findIndex((entry) => entry.key === key);
    if (index < 0 || this.isGroup(this.entries[index])) {
      return;
    }
    const group = this.groupOf(index);
    if (group >= 0 && this.collapsed.has(this.entries[group].key)) {
      this.collapsed.delete(this.entries[group].key);
      this.layout();
    }
    this.rows.forEach((row, i) => row.setAttribute('aria-selected', String(i === index)));
    this.setTabStop(index);
    this.rows[index].scrollIntoView({ block: 'nearest' });
    if (focus) {
      this.rows[index].focus();
    }
    this.onSelect(key);
  }

  private row(entry: Entry, index: number): HTMLElement {
    const row = document.createElement('div');
    row.className = this.isGroup(entry) ? 'nl-tree-item nl-tree-group' : 'nl-tree-item';
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(entry.level));
    row.dataset.key = entry.key;
    row.tabIndex = -1;
    row.style.setProperty('--nl-level', String(entry.level - 1));
    if (entry.muted) {
      row.classList.add('nl-muted');
    }
    row.title = entry.title ?? entry.label;

    const icon = document.createElement('span');
    icon.className = 'nl-tree-icon';
    icon.innerHTML = entry.icon;
    const label = document.createElement('span');
    label.className = 'nl-tree-label';
    label.textContent = entry.label;
    row.append(icon, label);
    if (entry.count !== undefined) {
      const count = document.createElement('span');
      count.className = 'nl-badge';
      count.textContent = String(entry.count);
      row.append(count);
    } else {
      row.setAttribute('aria-selected', 'false');
    }
    row.addEventListener('click', () => this.activate(index));
    return row;
  }

  private isGroup(entry: Entry): boolean {
    return entry.count !== undefined;
  }

  private groupOf(index: number): number {
    if (this.entries[index].level === 1) {
      return -1;
    }
    for (let i = index - 1; i >= 0; i--) {
      if (this.entries[i].level === 1) return i;
    }
    return -1;
  }

  private activate(index: number): void {
    const entry = this.entries[index];
    if (this.isGroup(entry)) {
      this.toggle(entry.key);
      this.setTabStop(index);
      this.rows[index].focus();
    } else {
      this.select(entry.key, true);
    }
  }

  private toggle(key: EntryKey, expand = this.collapsed.has(key)): void {
    if (expand) this.collapsed.delete(key);
    else this.collapsed.add(key);
    this.layout();
  }

  /** Hides the members of collapsed groups and labels each group's state. */
  private layout(): void {
    let hidden = false;
    this.entries.forEach((entry, index) => {
      const row = this.rows[index];
      if (entry.level === 1) {
        hidden = this.collapsed.has(entry.key);
        row.hidden = false;
        if (this.isGroup(entry)) {
          row.setAttribute('aria-expanded', String(!hidden));
          (row.querySelector('.nl-tree-icon') as HTMLElement).title = hidden
            ? this.strings.expand
            : this.strings.collapse;
        }
      } else {
        row.hidden = hidden;
      }
    });
  }

  private setTabStop(index: number): void {
    this.rows.forEach((row, i) => (row.tabIndex = i === index ? 0 : -1));
  }

  private onKeyDown(event: KeyboardEvent): void {
    const visible = this.rows.flatMap((row, index) => (row.hidden ? [] : [index]));
    const focused = this.rows.indexOf(document.activeElement as HTMLElement);
    if (focused < 0) return;
    const at = visible.indexOf(focused);
    const entry = this.entries[focused];
    let target: number | undefined;
    switch (event.key) {
      case 'ArrowDown':
        target = visible[Math.min(at + 1, visible.length - 1)];
        break;
      case 'ArrowUp':
        target = visible[Math.max(at - 1, 0)];
        break;
      case 'Home':
        target = visible[0];
        break;
      case 'End':
        target = visible[visible.length - 1];
        break;
      case 'ArrowRight':
        if (this.isGroup(entry) && this.collapsed.has(entry.key)) this.toggle(entry.key, true);
        else if (this.isGroup(entry)) target = focused + 1;
        break;
      case 'ArrowLeft':
        if (this.isGroup(entry) && !this.collapsed.has(entry.key)) this.toggle(entry.key, false);
        else if (this.groupOf(focused) >= 0) target = this.groupOf(focused);
        break;
      case 'Enter':
      case ' ':
        this.activate(focused);
        event.preventDefault();
        return;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          target = this.findTyped(event.key, visible, at);
          if (target === undefined) return;
          break;
        }
        return;
    }
    event.preventDefault();
    if (target === undefined) return;
    if (this.isGroup(this.entries[target])) {
      this.setTabStop(target);
      this.rows[target].focus();
    } else {
      this.select(this.entries[target].key, true);
    }
  }

  /** Type-ahead: the next visible entry whose name starts with what was typed in the last second. */
  private findTyped(key: string, visible: number[], at: number): number | undefined {
    const now = Date.now();
    this.typed = now - this.typedAt < 1000 ? this.typed + key.toLowerCase() : key.toLowerCase();
    this.typedAt = now;
    const start = this.typed.length > 1 ? at : at + 1;
    const order = [...visible.slice(start), ...visible.slice(0, start)];
    return order.find((index) => this.entries[index].label.toLowerCase().startsWith(this.typed));
  }
}
