import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

const open = (page: Page, key: string) => page.locator(`.nl-tree-item[data-key="${key}"]`).click();
const section = (page: Page, heading: string) =>
  page.locator('.nl-object-details .nl-section').filter({
    has: page.locator('.nl-heading', { hasText: new RegExp(`^${heading}$`) }),
  });
/** The cells of the row whose first cells read `first`. */
const rowOf = (page: Page, heading: string, name: string) =>
  section(page, heading)
    .locator('tbody tr')
    .filter({ has: page.locator('td', { hasText: new RegExp(`^${name}$`) }) })
    .locator('td');

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test(`lists a table's columns, indexes and foreign keys (${theme})`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.load('sample.sqlite');
    await open(page, 'table:albums');
    await page.getByRole('tab', { name: 'Schema' }).click();

    await expect(page.locator('.nl-object-details .nl-heading')).toHaveText([
      'Columns',
      'Indexes',
      'Foreign keys',
    ]);
    await expect(rowOf(page, 'Columns', 'id')).toHaveText(['1', 'id', 'INTEGER', 'PRIMARY KEY']);
    await expect(rowOf(page, 'Columns', 'title')).toHaveText(['3', 'title', 'TEXT', 'NOT NULL']);
    await expect(rowOf(page, 'Columns', 'rating')).toHaveText([
      '8',
      'rating',
      'INTEGER',
      'DEFAULT 0',
    ]);
    await expect(rowOf(page, 'Indexes', 'albums_by_artist')).toHaveText([
      'albums_by_artist',
      'artist_id',
      '',
    ]);
    await expect(section(page, 'Foreign keys').locator('tbody td').first()).toHaveText(
      'artist_id → artists (id)',
    );
    await expect(page.locator('.nl-heading', { hasText: 'Statement' })).toBeVisible();
    await expect(page.locator('.nl-sql')).toContainText('CREATE TABLE albums');
    await page.screenshot({ path: `${SCREENS}/schema-${theme}.png` });
    if (theme.startsWith('hc')) {
      expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(7);
    }
    expect(viewer.problems).toEqual([]);
  });
}

test('names automatic indexes, index columns and composite keys', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'table:album_tags');
  // The tabs stay where they are, so a second click doesn't land on the other tab.
  const schemaTab = page.getByRole('tab', { name: 'Schema' });
  const before = await schemaTab.boundingBox();
  await schemaTab.click();
  expect((await schemaTab.boundingBox())?.x).toBe(before?.x);
  await expect(rowOf(page, 'Columns', 'album_id')).toHaveText([
    '1',
    'album_id',
    'INTEGER',
    'PRIMARY KEY 1',
  ]);
  await expect(rowOf(page, 'Indexes', 'sqlite_autoindex_album_tags_1')).toHaveText([
    'sqlite_autoindex_album_tags_1',
    'album_id, tag',
    'UNIQUE · automatic, for PRIMARY KEY',
  ]);
  await expect(section(page, 'Foreign keys').locator('tbody tr')).toHaveCount(2);

  await open(page, 'index:albums_by_artist');
  await expect(rowOf(page, 'Columns', 'artist_id')).toHaveText(['1', 'artist_id', '']);

  await open(page, 'trigger:albums_unrated');
  await expect(page.locator('.nl-object-details')).toBeEmpty();
  await expect(page.locator('.nl-sql')).toContainText('CREATE TRIGGER albums_unrated');
  expect(viewer.problems).toEqual([]);
});
