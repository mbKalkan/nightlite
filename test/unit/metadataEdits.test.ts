import { describe, expect, it } from 'vitest';
import type { MetadataRow } from '../../src/extension/database/mbtiles';
import { MetadataEdits } from '../../src/extension/metadataEdits';

const row = (name: string, value: string, length = value.length): MetadataRow => ({
  name,
  value,
  length,
});

function edits(rows: MetadataRow[] = [row('name', 'Tiles'), row('minzoom', '0')]) {
  const metadata = new MetadataEdits();
  metadata.setRows({ kind: 'table', rows });
  return metadata;
}

const values = (metadata: MetadataEdits) =>
  metadata.state().entries.map((entry) => [entry.name, entry.value, entry.changed]);

describe('MetadataEdits', () => {
  it('shows the metadata as read, each key once', () => {
    const metadata = edits([
      row('name', 'Tiles'),
      row('name', 'Other'),
      row('json', '{"a"', 2_000_000),
    ]);
    expect(metadata.state()).toEqual({
      entries: [
        { name: 'name', value: 'Tiles', changed: false, added: false, copies: 2 },
        {
          name: 'json',
          value: '{"a"',
          changed: false,
          added: false,
          copies: 1,
          cutFrom: 2_000_000,
        },
      ],
    });
    expect(metadata.dirty).toBe(false);
  });

  it('changes, adds and removes keys, and undoes and redoes each', () => {
    const metadata = edits();
    const rename = metadata.edit('name', 'Renamed').edit;
    const add = metadata.edit('center', '0,0,1').edit;
    const remove = metadata.edit('minzoom', null).edit;
    expect(values(metadata)).toEqual([
      ['name', 'Renamed', true],
      ['center', '0,0,1', true],
    ]);
    expect(metadata.state().entries[1].added).toBe(true);
    expect(metadata.changes()).toEqual([
      ['name', 'Renamed'],
      ['center', '0,0,1'],
      ['minzoom', null],
    ]);
    remove?.undo();
    add?.undo();
    rename?.undo();
    expect(values(metadata)).toEqual([
      ['name', 'Tiles', false],
      ['minzoom', '0', false],
    ]);
    expect(metadata.dirty).toBe(false);
    rename?.redo();
    expect(metadata.changes()).toEqual([['name', 'Renamed']]);
  });

  it('counts a key set back to the value it has as no change', () => {
    const metadata = edits();
    metadata.edit('name', 'Renamed');
    metadata.edit('name', 'Tiles');
    expect(metadata.dirty).toBe(false);
    expect(metadata.edit('name', 'Tiles')).toEqual({ changed: false });
  });

  it('folds keystrokes into the edit being typed, which undoes as one', () => {
    const metadata = edits();
    const first = metadata.edit('name', 'TilesA');
    expect(first.edit).toBeDefined();
    expect(metadata.edit('name', 'TilesAB', true)).toEqual({ changed: true });
    expect(metadata.edit('name', 'TilesABC', true)).toEqual({ changed: true });
    expect(values(metadata)[0]).toEqual(['name', 'TilesABC', true]);
    first.edit?.undo();
    expect(values(metadata)[0]).toEqual(['name', 'Tiles', false]);
    first.edit?.redo();
    expect(values(metadata)[0]).toEqual(['name', 'TilesABC', true]);
  });

  it('starts a new edit after an undo, a save or another key', () => {
    const metadata = edits();
    const first = metadata.edit('name', 'A').edit;
    first?.undo();
    expect(metadata.edit('name', 'B', true).edit).toBeDefined();
    metadata.clear();
    expect(metadata.edit('name', 'C', true).edit).toBeDefined();
    metadata.edit('minzoom', '3');
    expect(metadata.edit('name', 'D', true).edit).toBeDefined();
  });

  it('keeps changes across a reload, dropping those the file has now', () => {
    const metadata = edits();
    metadata.edit('name', 'Renamed');
    metadata.edit('minzoom', '4');
    metadata.setRows({ kind: 'table', rows: [row('name', 'Renamed'), row('minzoom', '1')] });
    expect(metadata.changes()).toEqual([['minzoom', '4']]);
  });

  it('keeps changes in a backup and takes them back from one', () => {
    const metadata = edits();
    metadata.edit('name', 'Renamed');
    metadata.edit('minzoom', null);
    const restored = new MetadataEdits();
    restored.restore(metadata.backup());
    restored.setRows({ kind: 'table', rows: [row('name', 'Tiles'), row('minzoom', '0')] });
    expect(restored.changes()).toEqual(metadata.changes());
    expect(values(restored)).toEqual([['name', 'Renamed', true]]);
    restored.restore('{"changes":[["bad",5],[1,"x"]]}');
    expect(restored.changes()).toHaveLength(2);
  });

  it("doesn't edit metadata that isn't a table", () => {
    const view = new MetadataEdits();
    view.setRows({ kind: 'view', rows: [row('name', 'Tiles')] });
    expect(view.state()).toEqual({ readOnly: 'view', entries: [] });
    expect(view.edit('name', 'Renamed')).toEqual({ changed: false });
    const none = new MetadataEdits();
    none.setRows({ kind: null, rows: [] });
    expect(none.state()).toEqual({ readOnly: 'noTable', entries: [] });
  });
});
