import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';

const SCREENS = 'test-results/screens';

const open = (page: Page, key: string) => page.locator(`.nl-tree-item[data-key="${key}"]`).click();
const grid = (page: Page) => page.locator('.nl-grid');
const counts = (page: Page) => page.locator('.nl-status-counts');
const head = (page: Page, name: string) =>
  page.getByRole('columnheader', { name: new RegExp(`^${name}\\b`) });
const sortButton = (page: Page, name: string) =>
  page.getByRole('button', { name: `Sort by ${name}` });
/** A column's values on screen, top to bottom. */
const column = (page: Page, index: number) =>
  page
    .locator('.nl-grid-row:not(.nl-grid-loading)')
    .evaluateAll(
      (rows, c) => rows.map((row) => row.querySelectorAll('.nl-grid-cell')[c + 1]?.textContent),
      index,
    );
const search = (page: Page) => page.getByRole('textbox', { name: 'Search rows' });
const filter = (page: Page, name: string) => page.getByRole('textbox', { name: `Filter ${name}` });

for (const theme of ['dark', 'light'] as const) {
  test(`sorts by a column and filters by another (${theme})`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.load('sample.sqlite');
    await open(page, 'table:albums');
    await expect(counts(page)).toHaveText('5 rows · 8 columns');

    await head(page, 'price').hover();
    await sortButton(page, 'price').click();
    await expect(head(page, 'price')).toHaveAttribute('aria-sort', 'ascending');
    // NULL first, as SQLite sorts; the rowids say where each row is stored.
    await expect.poll(() => column(page, 4)).toEqual(['NULL', '7.25', '9.99', '12.5', '14.0']);
    await expect(page.locator('.nl-grid-row .nl-grid-rowhead')).toHaveText([
      '5',
      '3',
      '1',
      '2',
      '4',
    ]);
    await expect(counts(page)).toHaveText('5 rows · 8 columns');

    await page.getByRole('button', { name: 'Filter by Column' }).click();
    // The keyboard goes to the active cell's column.
    await expect(filter(page, 'id')).toBeFocused();
    await filter(page, 'released').fill('>1970');
    await expect(counts(page)).toHaveText('3 matching rows · 8 columns');
    await expect.poll(() => column(page, 2)).toEqual(['Homogenic', 'Gülümse', '2023']);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${SCREENS}/views-${theme}.png` });

    // Descending, then as stored; the filter stays.
    await sortButton(page, 'price').click();
    await expect(head(page, 'price')).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(() => column(page, 2)).toEqual(['2023', 'Gülümse', 'Homogenic']);
    await sortButton(page, 'price').click();
    await expect(head(page, 'price')).not.toHaveAttribute('aria-sort');
    await expect.poll(() => column(page, 2)).toEqual(['2023', 'Gülümse', 'Homogenic']);

    // Hiding the filters drops them.
    await page.getByRole('button', { name: 'Filter by Column' }).click();
    await expect(counts(page)).toHaveText('5 rows · 8 columns');
    expect(viewer.problems).toEqual([]);
  });
}

test('searches every column, from Ctrl+F', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'table:albums');
  await grid(page).focus();
  await page.keyboard.press('Control+f');
  await expect(search(page)).toBeFocused();
  await page.keyboard.type('BLUE');
  await expect(counts(page)).toHaveText('2 matching rows · 8 columns');
  await expect.poll(() => column(page, 2)).toEqual(['Pastel Blues', 'Kind of Blue']);

  await page.keyboard.type(' moon');
  await expect(grid(page)).toContainText('No rows match.');
  await expect(counts(page)).toHaveText('0 matching rows · 8 columns');

  // The search is kept with the table.
  await open(page, 'table:artists');
  await expect(search(page)).toHaveValue('');
  await open(page, 'table:albums');
  await expect(search(page)).toHaveValue('BLUE moon');
  await expect(counts(page)).toHaveText('0 matching rows · 8 columns');

  await search(page).press('Escape');
  await expect(search(page)).toHaveValue('');
  await expect(counts(page)).toHaveText('5 rows · 8 columns');
  await search(page).press('Escape');
  await expect(grid(page)).toBeFocused();
  expect(viewer.problems).toEqual([]);
});

test('sorts from the context menu, by the active cell’s column', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'table:events');
  await expect(counts(page)).toHaveText('5,000 rows · 4 columns');
  await page.locator('.nl-grid-row').first().locator('.nl-grid-cell').nth(1).click();
  await viewer.post({ type: 'sortRows', direction: 'descending' });
  await expect(head(page, 'id')).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(async () => (await column(page, 0))[0]).toBe('5000');
  // Any row of the sorted rows is a key away.
  await page.keyboard.press('Control+End');
  await expect(page.locator('.nl-status-where')).toHaveText('rowid 1 · amount');

  await viewer.post({ type: 'sortRows', direction: null });
  await expect(head(page, 'id')).not.toHaveAttribute('aria-sort');
  await expect.poll(async () => (await column(page, 0))[0]).toBe('1');
  expect(viewer.problems).toEqual([]);
});

test('stops sorting, keeping the rows found so far', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'table:events');
  await expect(counts(page)).toHaveText('5,000 rows · 4 columns');
  viewer.slowQueries(300);
  await head(page, 'kind').hover();
  await sortButton(page, 'kind').click();
  await expect(counts(page)).toHaveText(/^Sorting…/);
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await grid(page).press('Escape');
  await expect(counts(page)).toHaveText(
    /^[\d,]+ rows · Stopped: the rows found so far · 4 columns$/,
  );
  await expect(page.getByRole('button', { name: 'Stop' })).toBeHidden();
  expect(viewer.problems).toEqual([]);
});
