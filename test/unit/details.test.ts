import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { readDetails } from '../../src/extension/database/details';

const sample = new DatabaseSync('test/fixtures/sample.sqlite', { readOnly: true });
afterAll(() => sample.close());

describe('readDetails', () => {
  it("lists a table's columns, indexes and foreign keys", () => {
    const albums = readDetails(sample, 'albums');
    expect(albums.columns?.map((column) => column.name)).toEqual([
      'id',
      'artist_id',
      'title',
      'released',
      'price',
      'cover',
      'details',
      'rating',
    ]);
    expect(albums.columns?.[0]).toMatchObject({ type: 'INTEGER', primaryKey: 1, hidden: false });
    expect(albums.columns?.[2]).toMatchObject({ notNull: true });
    expect(albums.columns?.[7]).toMatchObject({ defaultValue: '0' });
    expect(albums.indexes).toEqual([
      {
        name: 'albums_by_artist',
        unique: false,
        origin: 'c',
        partial: false,
        columns: ['artist_id'],
      },
    ]);
    expect(albums.foreignKeys).toEqual([
      {
        table: 'artists',
        from: ['artist_id'],
        to: ['id'],
        onUpdate: 'NO ACTION',
        onDelete: 'NO ACTION',
      },
    ]);
  });

  it('keeps foreign keys in the order the table declares them', () => {
    const tags = readDetails(sample, 'album_tags');
    expect(tags.foreignKeys?.map((key) => key.table)).toEqual(['albums', 'tags']);
    expect(tags.indexes?.[0]).toMatchObject({
      unique: true,
      origin: 'pk',
      columns: ['album_id', 'tag'],
    });
  });

  it("lists an index's key columns, and nothing for triggers", () => {
    expect(readDetails(sample, 'albums_by_artist')).toEqual({
      indexColumns: [{ name: 'artist_id', descending: false, collation: 'BINARY' }],
    });
    expect(readDetails(sample, 'albums_unrated')).toEqual({});
  });

  it('describes views by their columns', () => {
    const view = readDetails(sample, 'album_list');
    expect(view.columns?.map((column) => column.name)).toEqual(['title', 'artist', 'released']);
    expect(view.indexes).toEqual([]);
  });
});
