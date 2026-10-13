import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

const open = (page: Page, key: string) => page.locator(`.nl-tree-item[data-key="${key}"]`).click();
const grid = (page: Page) => page.locator('.nl-grid');
const footer = (page: Page) => page.locator('.nl-footer');
/** The row whose row header (rowid or number) reads `label`. */
const row = (page: Page, label: string) =>
  page.locator('.nl-grid-row').filter({
    has: page.locator('.nl-grid-rowhead', { hasText: new RegExp(`^${label}$`) }),
  });
const cell = (page: Page, label: string, column: number) =>
  row(page, label)
    .locator('.nl-grid-cell')
    .nth(column + 1);

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test(`shows every kind of value (${theme})`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.load('sample.sqlite');
    await open(page, 'table:value_kinds');

    await expect(page.locator('.nl-grid-head .nl-grid-name')).toHaveText(['id', 'label', 'value']);
    await expect(page.locator('.nl-grid-corner')).toHaveText('rowid');
    await expect(footer(page)).toHaveText('18 rows · 3 columns');
    await expect(cell(page, '1', 2)).toHaveText('42');
    await expect(cell(page, '3', 2)).toHaveText('42.0');
    await expect(cell(page, '4', 2)).toHaveText('9007199254740993');
    await expect(cell(page, '4', 2)).toHaveClass(/nl-number/);
    await expect(cell(page, '5', 2)).toHaveText('3.14159');
    await expect(cell(page, '7', 2)).toHaveText('1e+300');
    await expect(cell(page, '10', 2)).toHaveText('first line↵second line↵→indented');
    await expect(cell(page, '12', 2)).toHaveText(/^Lorem ipsum.*…$/);
    await expect(cell(page, '15', 2)).toHaveText('BLOB · 6 B');
    await expect(cell(page, '17', 2)).toHaveText(/^PNG · \d+ B$/);
    await expect(cell(page, '18', 2)).toHaveText('NULL');
    await expect(cell(page, '18', 2)).toHaveClass(/nl-null/);
    await page.screenshot({ path: `${SCREENS}/grid-${theme}.png` });
    expect(viewer.problems).toEqual([]);
  });
}

test('keeps a REAL that is whole looking like a real', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'table:albums');
  // Kind of Blue's price was stored as 14 into a REAL column.
  await expect(cell(page, '4', 4)).toHaveText('14.0');
  await expect(cell(page, '5', 4)).toHaveText('NULL');
});

test('scrolls through thousands of rows with the keyboard', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'table:events');
  await expect(footer(page)).toHaveText('5,000 rows · 4 columns');

  await grid(page).focus();
  await page.keyboard.press('End');
  await expect(row(page, '5000')).toBeVisible();
  await page.keyboard.press('Home');
  await expect(row(page, '1')).toBeVisible();
  await page.keyboard.press('PageDown');
  await expect(row(page, '1')).toBeHidden();
  expect(viewer.problems).toEqual([]);
});

test('shows the estimate while rows are still being counted', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite', { count: false });
  await open(page, 'table:events');
  await expect(footer(page)).toHaveText('About 5,000 rows (counting…) · 4 columns');
  await expect(row(page, '1')).toBeVisible();
});

test('numbers the rows of views and tables without rowids', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'view:album_list');
  await expect(page.locator('.nl-grid-corner')).toHaveText('#');
  await expect(footer(page)).toHaveText('5 rows · 3 columns');
  await expect(cell(page, '1', 0)).toHaveText('Pastel Blues');

  await open(page, 'table:tags');
  await expect(page.locator('.nl-grid-corner')).toHaveText('#');
  await expect(footer(page)).toHaveText('3 rows · 2 columns');
  await expect(page.locator('.nl-grid-head .nl-grid-key')).toHaveCount(1);
});

test('says when a table has no rows', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'table:empty_table');
  await expect(page.locator('.nl-grid-message')).toHaveText('This table has no rows.');
  await expect(footer(page)).toHaveText('0 rows · 2 columns');
});

test('explains rows that cannot be read', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('corrupt.sqlite');
  await open(page, 'table:readings');
  await expect(page.locator('.nl-grid-message strong')).toHaveText("These rows couldn't be read");
  await expect(page.locator('.nl-grid-message')).toContainText('The database file is damaged.');
  await page.screenshot({ path: `${SCREENS}/grid-error-dark.png` });
});

test('switches between Data and Schema with the arrow keys and remembers it', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'table:artists');
  await page.getByRole('tab', { name: 'Data' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Schema' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.nl-sql')).toContainText('CREATE TABLE artists');

  await open(page, 'table:albums');
  await expect(page.locator('.nl-sql')).toContainText('CREATE TABLE albums');
  await open(page, 'index:albums_by_artist');
  await expect(page.getByRole('tab', { name: 'Data' })).toBeHidden();
});

const LARGE = 'test/fixtures/generated/large.sqlite';

test('reaches any of ten million rows at once', async ({ page }) => {
  test.skip(!existsSync(LARGE), 'run `npm run fixtures:large` first');
  const viewer = await openViewer(page, 'dark');
  await viewer.load('generated/large.sqlite');
  await open(page, 'table:measurements');
  await expect(footer(page)).toHaveText('10,000,000 rows · 4 columns');

  await grid(page).focus();
  await page.keyboard.press('End');
  await expect(row(page, '10000000')).toBeVisible();

  // Drag the scrollbar halfway: the scaled scrollbar maps it to the middle of the table.
  await grid(page).evaluate((el) => {
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
  });
  await expect(page.locator('.nl-grid-row:not(.nl-grid-loading)').first()).toBeVisible();
  const first = Number(await page.locator('.nl-grid-row .nl-grid-rowhead').nth(10).textContent());
  expect(first).toBeGreaterThan(4_900_000);
  expect(first).toBeLessThan(5_100_000);

  // The wheel still moves a few rows at a time, not thousands.
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 3 * 22);
  await page.waitForTimeout(100);
  const after = Number(await page.locator('.nl-grid-row .nl-grid-rowhead').nth(10).textContent());
  expect(after - first).toBeGreaterThan(0);
  expect(after - first).toBeLessThan(10);
  expect(viewer.problems).toEqual([]);
});
