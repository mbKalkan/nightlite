import type { MetadataEntry, MetadataState } from '../shared/protocol';
import type { MetadataRow } from './database/mbtiles';
import type { MetadataChange } from './database/metadataWrite';

/** A key's change not saved yet: a new value, or null when it's removed. */
type Pending = string | null;

/** A change made, to take back or make again: what VS Code's undo and redo call. */
export interface MetadataEdit {
  undo(): void;
  redo(): void;
}

/** A change still being typed: each keystroke amends it, and it undoes as one. */
export interface AmendableEdit extends MetadataEdit {
  amend(value: string | null): void;
}

/**
 * An MBTiles file's metadata as read, and the changes to it not saved yet, by key. Setting a key
 * back to the value the file has drops its change, so the file is clean again.
 */
export class MetadataEdits {
  private rows: MetadataRow[] | undefined;
  private kind: 'table' | 'view' | null = null;
  private readonly pending = new Map<string, Pending>();
  /** The edit being typed into, while it's the latest and neither undone nor saved. */
  private typing: { name: string; edit: AmendableEdit } | undefined;

  /** The metadata as the file has it now: when first read, after a save, or after a reload. */
  setRows(read: { kind: 'table' | 'view' | null; rows: MetadataRow[] }): void {
    this.kind = read.kind;
    this.rows = read.rows;
    // Changes that now match the file are no longer changes.
    for (const [name, value] of this.pending) {
      if (value === this.saved(name)) this.pending.delete(name);
    }
  }

  get loaded(): boolean {
    return this.rows !== undefined;
  }

  get dirty(): boolean {
    return this.pending.size > 0;
  }

  /**
   * Sets a key, or removes it with null. With `amend`, a keystroke goes into the edit being typed
   * into the same key, so the field's typing undoes as one. Says whether anything changed, and
   * hands back the new edit for VS Code's undo stack, if there is one.
   */
  edit(name: string, value: Pending, amend = false): { changed: boolean; edit?: MetadataEdit } {
    const typing = this.typing;
    if (amend && typing?.name === name) {
      typing.edit.amend(value);
      return { changed: true };
    }
    const edit = this.change(name, value);
    if (!edit) return { changed: false };
    const current = { name, edit };
    this.typing = current;
    return {
      changed: true,
      edit: {
        undo: () => {
          // Typing on after an undo starts a new edit.
          if (this.typing === current) this.typing = undefined;
          edit.undo();
        },
        redo: () => edit.redo(),
      },
    };
  }

  private change(name: string, value: Pending): AmendableEdit | undefined {
    if (this.kind !== 'table' || !this.rows) return undefined;
    if (value === this.current(name)) return undefined;
    const before = this.pending.has(name) ? (this.pending.get(name) as Pending) : undefined;
    // A key set back to the value the file has is no change at all.
    const target = (next: Pending) => (next === this.saved(name) ? undefined : next);
    let after = target(value);
    const apply = (state: Pending | undefined) => {
      if (state === undefined) this.pending.delete(name);
      else this.pending.set(name, state);
    };
    apply(after);
    return {
      undo: () => apply(before),
      redo: () => apply(after),
      amend: (next) => {
        after = target(next);
        apply(after);
      },
    };
  }

  /** What saving writes: each changed key and its value, or null to remove it. */
  changes(): MetadataChange[] {
    return [...this.pending];
  }

  /** The changes are in the file now, or are dropped; typing on starts a new edit. */
  clear(): void {
    this.pending.clear();
    this.typing = undefined;
  }

  /** The changes, to keep in a backup while VS Code closes with them unsaved. */
  backup(): string {
    return JSON.stringify({ changes: this.changes() });
  }

  restore(backup: string): void {
    const { changes } = JSON.parse(backup) as { changes?: MetadataChange[] };
    for (const [name, value] of changes ?? []) {
      if (typeof name === 'string' && (typeof value === 'string' || value === null)) {
        this.pending.set(name, value);
      }
    }
  }

  state(): MetadataState {
    if (this.kind !== 'table') {
      return { readOnly: this.kind === 'view' ? 'view' : 'noTable', entries: [] };
    }
    const entries: MetadataEntry[] = [];
    const seen = new Map<string, MetadataEntry>();
    for (const row of this.rows ?? []) {
      const known = seen.get(row.name);
      if (known) {
        known.copies++;
        continue;
      }
      const pending = this.pending.get(row.name);
      const entry: MetadataEntry = {
        name: row.name,
        value: typeof pending === 'string' ? pending : row.value,
        changed: pending !== undefined,
        added: false,
        copies: 1,
      };
      if (pending === undefined && row.length > row.value.length) entry.cutFrom = row.length;
      seen.set(row.name, entry);
      if (pending !== null) entries.push(entry);
    }
    for (const [name, value] of this.pending) {
      if (!seen.has(name) && value !== null) {
        entries.push({ name, value, changed: true, added: true, copies: 0 });
      }
    }
    return { entries };
  }

  /** The value the editor shows for a key; null when there's none. */
  private current(name: string): Pending {
    return this.pending.has(name) ? (this.pending.get(name) as Pending) : this.saved(name);
  }

  /** The value the file has for a key, its first when it has several; null when there's none. */
  private saved(name: string): Pending {
    const row = this.rows?.find((candidate) => candidate.name === name);
    return row ? row.value : null;
  }
}
