import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';

const item = (page: Page, key: string) => page.locator(`.nl-tree-item[data-key="${key}"]`);
const counts = (page: Page) => page.locator('.nl-status-counts');
const note = (page: Page) => page.locator('.nl-status-note');
/** The row whose row header (rowid or number) reads `label`. */
const cell = (page: Page, label: string, column: number) =>
  page
    .locator('.nl-grid-row')
    .filter({ has: page.locator('.nl-grid-rowhead', { hasText: new RegExp(`^${label}$`) }) })
    .locator('.nl-grid-cell')
    .nth(column + 1);

test('copies a reference to cells, with their values', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await item(page, 'table:albums').click();
  await expect(counts(page)).toHaveText('5 rows · 8 columns');

  // A right click selects the cell it's on, as for Copy.
  await cell(page, '3', 2).click({ button: 'right' });
  await viewer.post({ type: 'copyReference', withText: false });
  await expect
    .poll(() => viewer.clipboard.at(-1))
    .toBe('sample.sqlite, table "albums", rowid 3, column "title"');
  await viewer.post({ type: 'copyReference', withText: true });
  await expect
    .poll(() => viewer.clipboard.at(-1))
    .toBe('sample.sqlite, table "albums", rowid 3, column "title":\n> Gülümse');
  // VS Code's status bar says so; the grid's own note stays quiet.
  await expect(note(page)).toHaveText('');

  // A block: its values as a Markdown table, read in full.
  await cell(page, '1', 2).click();
  await cell(page, '2', 4).click({ modifiers: ['Shift'] });
  await viewer.post({ type: 'copyReference', withText: true });
  await expect
    .poll(() => viewer.clipboard.at(-1))
    .toBe(
      [
        'sample.sqlite, table "albums", rowids 1 to 2, columns "title" to "price":',
        '| title        | released   | price |',
        '| ------------ | ---------- | ----: |',
        '| Pastel Blues | 1965-10-01 |  9.99 |',
        '| 2023         | 1975-01-01 |  12.5 |',
      ].join('\n'),
    );

  // Sorted otherwise, rows are named by their rowids one by one.
  await cell(page, '1', 4).click();
  await viewer.post({ type: 'sortRows', direction: 'descending' });
  const heads = page.locator('.nl-grid-row .nl-grid-rowhead');
  await expect(heads.first()).toHaveText('4');
  await heads.nth(0).click();
  await heads.nth(2).click({ modifiers: ['Shift'] });
  await viewer.post({ type: 'copyReference', withText: false });
  await expect
    .poll(() => viewer.clipboard.at(-1))
    .toBe('sample.sqlite, table "albums", rowids 4, 2, 1');
  // All of the rows go without saying, but not how they were sorted.
  await heads.nth(4).click({ modifiers: ['Shift'] });
  await cell(page, '5', 2).click({ modifiers: ['Shift'] });
  await viewer.post({ type: 'copyReference', withText: false });
  await expect
    .poll(() => viewer.clipboard.at(-1))
    .toBe(
      'sample.sqlite, table "albums", sorted by "price" descending, columns "title" to "rating"',
    );
  expect(viewer.problems).toEqual([]);
});

test('copies a reference to an object right-clicked in the sidebar, with its statement', async ({
  page,
}) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await item(page, 'table:albums').click();
  // VS Code reads the menu's items from here.
  expect(
    JSON.parse((await item(page, 'index:albums_by_artist').getAttribute('data-vscode-context'))!),
  ).toEqual({ webviewSection: 'object' });
  expect(await item(page, 'query').getAttribute('data-vscode-context')).toBeNull();

  await item(page, 'index:albums_by_artist').click({ button: 'right' });
  await viewer.post({ type: 'copyReference', withText: true });
  await expect
    .poll(() => viewer.clipboard.at(-1))
    .toBe(
      'sample.sqlite, index "albums_by_artist":\n```sql\nCREATE INDEX albums_by_artist ON albums (artist_id)\n```',
    );

  // A right click is used once: the Command Palette's Copy Reference then means what's shown.
  await item(page, 'view:album_list').click({ button: 'right' });
  await page.keyboard.press('Escape');
  await viewer.post({ type: 'copyReference', withText: false });
  await expect
    .poll(() => viewer.clipboard.at(-1))
    .toBe('sample.sqlite, table "albums", rowid 1, column "id"');

  // The Schema tab names the object it shows.
  await page.getByRole('tab', { name: 'Schema' }).click();
  await viewer.post({ type: 'copyReference', withText: false });
  await expect.poll(() => viewer.clipboard.at(-1)).toBe('sample.sqlite, table "albums"');

  // The overview, the file alone.
  await item(page, 'overview').click();
  await viewer.post({ type: 'copyReference', withText: true });
  await expect.poll(() => viewer.clipboard.at(-1)).toBe('sample.sqlite');
  expect(viewer.problems).toEqual([]);
});

test("copies a reference to a query's results by their statement", async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await item(page, 'query').click();
  const editor = page.getByRole('textbox', { name: 'SQL statement' });
  await editor.fill('SELECT name, country\nFROM artists -- all of them\nORDER BY born;');
  await editor.press('Control+Enter');
  await expect(page.locator('.nl-query-status')).toHaveText(/^6 rows/);
  const results = page.getByRole('grid', { name: 'Query results' });
  await results.locator('.nl-grid-row').nth(1).locator('.nl-grid-cell').nth(1).click({
    button: 'right',
  });
  await viewer.post({ type: 'copyReference', withText: true });
  await expect
    .poll(() => viewer.clipboard.at(-1))
    .toBe(
      'sample.sqlite, result of `SELECT name, country FROM artists ORDER BY born`, row 2, column "name":\n> Miles Davis',
    );
  expect(viewer.problems).toEqual([]);
});

test('copies a reference to the tile shown', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.mbtiles');
  await page.locator('.nl-tree-item', { hasText: 'Tile Browser' }).click();
  await expect(page.locator('.nl-tile-address')).toHaveText('1/1/1');
  expect(
    JSON.parse((await page.locator('.nl-tiles').getAttribute('data-vscode-context'))!),
  ).toEqual({ webviewSection: 'tile' });
  // A right click in the list picks the tile it's on.
  await page.locator('.nl-tile-row[role="option"]').first().click({ button: 'right' });
  await expect(page.locator('.nl-tile-address')).toHaveText('1/0/1');
  await viewer.post({ type: 'copyReference', withText: false });
  await expect.poll(() => viewer.clipboard.at(-1)).toBe('sample.mbtiles, tile 1/0/1 (XYZ)');
  expect(viewer.problems).toEqual([]);
});
