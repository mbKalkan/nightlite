import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

const open = (page: Page, key: string) => page.locator(`.nl-tree-item[data-key="${key}"]`).click();
const grid = (page: Page) => page.locator('.nl-grid');
const footer = (page: Page) => page.locator('.nl-status-counts');
const status = (page: Page) => page.locator('.nl-status-selection');
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
  await page.keyboard.press('Control+End');
  await expect(row(page, '5000')).toBeVisible();
  await expect(status(page)).toContainText('rowid 5000 · amount');
  await page.keyboard.press('Control+Home');
  await expect(row(page, '1')).toBeVisible();
  await page.keyboard.press('PageDown');
  await expect(row(page, '1')).toBeHidden();
  await page.keyboard.press('Control+ArrowDown');
  await expect(row(page, '5000')).toBeVisible();
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

const where = (page: Page) => page.locator('.nl-status-where');
const kind = (page: Page) => page.locator('.nl-status-type').first();
const value = (page: Page) => page.locator('.nl-status-value');
const note = (page: Page) => page.locator('.nl-status-note');
const head = (page: Page, name: string) =>
  page.locator('.nl-grid-head').filter({ has: page.locator('.nl-grid-name', { hasText: name }) });
const selectedCells = (page: Page) => page.locator('[role="gridcell"].nl-grid-sel');

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`selects cells like a spreadsheet and shows the active one below (${theme})`, async ({
    page,
  }) => {
    const viewer = await openViewer(page, theme);
    await viewer.load('sample.sqlite');
    await open(page, 'table:value_kinds');
    // The first cell is active from the start.
    await expect(where(page)).toHaveText('rowid 1 · id');
    await expect(kind(page)).toHaveText('INTEGER');
    await expect(value(page)).toHaveText('1');

    await cell(page, '12', 2).click();
    await expect(where(page)).toHaveText('rowid 12 · value');
    await expect(kind(page)).toHaveText('TEXT');
    await expect(value(page)).toHaveText(/^Lorem ipsum.*…$/);
    await expect(status(page)).toContainText('11,200 characters');
    await page.keyboard.press('ArrowDown');
    await expect(where(page)).toHaveText('rowid 13 · value');
    await expect(value(page)).toHaveText('{"a":1,"b":[true,null,"x"],"c":{"d":2.5}}');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(where(page)).toHaveText('rowid 17 · value');
    await expect(value(page)).toHaveText(/^PNG · \d+ B$/);
    await page.keyboard.press('ArrowDown');
    await expect(kind(page)).toHaveText('NULL');
    await expect(value(page)).toHaveCount(0);

    await cell(page, '9', 1).click();
    await cell(page, '11', 2).click({ modifiers: ['Shift'] });
    await expect(status(page)).toHaveText('3 rows × 2 columns');
    await expect(selectedCells(page)).toHaveCount(6);
    await expect(head(page, 'label')).toHaveClass(/nl-grid-sel/);
    await expect(head(page, 'id')).not.toHaveClass(/nl-grid-sel/);
    await expect(grid(page)).toHaveAttribute('aria-activedescendant', 'nl-grid-active');
    await expect(cell(page, '11', 2)).toHaveId('nl-grid-active');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(status(page)).toHaveText('4 rows × 2 columns');
    await page.screenshot({ path: `${SCREENS}/grid-selection-${theme}.png` });

    await page.keyboard.press('Escape');
    await expect(where(page)).toHaveText('rowid 12 · value');
    await page.keyboard.press('Control+a');
    await expect(status(page)).toHaveText('18 rows × 3 columns');
    // VS Code follows Ctrl+A with Select All on the webview; no text around the grid lights up.
    const selectedText = await page.evaluate(() => {
      document.execCommand('selectAll');
      return getSelection()?.toString();
    });
    expect(selectedText).toBe('');
    expect(viewer.problems).toEqual([]);
  });
}

test('selects whole rows and columns from their headers', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'table:value_kinds');

  await head(page, 'label').click();
  await expect(status(page)).toHaveText('18 rows × 1 column');
  await head(page, 'value').click({ modifiers: ['Shift'] });
  await expect(status(page)).toHaveText('18 rows × 2 columns');

  await row(page, '3').locator('.nl-grid-rowhead').click();
  await expect(status(page)).toHaveText('1 row × 3 columns');
  await row(page, '5')
    .locator('.nl-grid-rowhead')
    .click({ modifiers: ['Shift'] });
  await expect(status(page)).toHaveText('3 rows × 3 columns');
  await expect(row(page, '4').locator('.nl-grid-rowhead')).toHaveClass(/nl-grid-sel/);

  await page.locator('.nl-grid-corner').click();
  await expect(status(page)).toHaveText('18 rows × 3 columns');
});

test('copies full values through the extension host', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'table:value_kinds');

  // The grid holds only the first 1,000 characters; the copy has all of them.
  await cell(page, '12', 2).click();
  await page.keyboard.press('Control+c');
  await expect(note(page)).toHaveText('Copied the value.');
  expect(viewer.clipboard.at(-1)).toHaveLength(11200);

  await cell(page, '9', 1).click();
  await cell(page, '10', 2).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+c');
  await expect(note(page)).toHaveText('Copied 2 rows.');
  expect(viewer.clipboard.at(-1)).toBe(
    'text that looks like a number\t007\nmulti-line text\t"first line\nsecond line\n\tindented"',
  );

  await row(page, '15').locator('.nl-grid-rowhead').click();
  await page.keyboard.press('Control+c');
  await expect(note(page)).toHaveText('Copied 1 row.');
  expect(viewer.clipboard.at(-1)).toBe('15\tblob\t0001027f80ff');
  expect(viewer.problems).toEqual([]);
});

const LARGE = 'test/fixtures/generated/large.sqlite';

test('reaches any of ten million rows at once', async ({ page }) => {
  test.skip(!existsSync(LARGE), 'run `npm run fixtures:large` first');
  const viewer = await openViewer(page, 'dark');
  await viewer.load('generated/large.sqlite');
  await open(page, 'table:measurements');
  await expect(footer(page)).toHaveText('10,000,000 rows · 4 columns');

  await grid(page).focus();
  await page.keyboard.press('Control+End');
  await expect(row(page, '10000000')).toBeVisible();

  // Drag the scrollbar halfway: the scaled scrollbar maps it to the middle of the table.
  await grid(page).evaluate((el) => {
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
  });
  const label = async () =>
    Number(await page.locator('.nl-grid-row .nl-grid-rowhead').nth(10).textContent());
  // Rows read near the middle replace the last ones once they arrive.
  await expect
    .poll(async () => {
      const shown = await label();
      return shown > 4_900_000 && shown < 5_100_000;
    })
    .toBe(true);
  const first = await label();

  // The wheel still moves a few rows at a time, not thousands.
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 3 * 22);
  await page.waitForTimeout(100);
  const after = await label();
  expect(after - first).toBeGreaterThan(0);
  expect(after - first).toBeLessThan(10);

  // Copying everything stops at the clipboard limit, and says so.
  await page.keyboard.press('Control+a');
  await expect(status(page)).toHaveText('10,000,000 rows × 4 columns');
  await page.keyboard.press('Control+c');
  await expect(note(page)).toHaveText(
    /^Copied the first [\d,]+ rows: a copy holds at most 1,000,000 rows or 16 MB\.$/,
  );
  expect(viewer.problems).toEqual([]);
});

const detail = (page: Page) => page.locator('.nl-detail');
const detailToggle = (page: Page) => page.locator('.nl-detail-toggle');
const facts = (page: Page) => page.locator('.nl-detail-facts');
const shown = (page: Page, selector: string) =>
  page.locator(`.nl-detail-body ${selector}`).evaluate((el) => el.textContent);

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test(`shows the selected cell in full beside the rows (${theme})`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.load('sample.sqlite');
    await open(page, 'table:value_kinds');
    await expect(detail(page)).toBeHidden();

    await cell(page, '13', 2).click();
    await page.keyboard.press('Enter');
    await expect(detail(page)).toBeVisible();
    await expect(detailToggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.nl-detail-title')).toHaveText('value');
    await expect(page.locator('.nl-detail-place')).toHaveText('rowid 13');
    await expect(facts(page)).toHaveText('TEXT · 41 characters');
    expect(await shown(page, '.nl-detail-json')).toBe(
      '{\n  "a": 1,\n  "b": [\n    true,\n    null,\n    "x"\n  ],\n  "c": {\n    "d": 2.5\n  }\n}',
    );
    await expect(page.locator('.nl-json-key').first()).toHaveText('"a"');
    // Enter puts the keyboard in the panel; Escape brings it back to the grid.
    await expect(page.locator('.nl-detail-body')).toBeFocused();
    await page.screenshot({ path: `${SCREENS}/detail-json-${theme}.png` });
    await page.keyboard.press('Escape');
    await expect(grid(page)).toBeFocused();
    expect(viewer.problems).toEqual([]);
  });
}

test('shows long text, BLOBs, NULL and big integers in full, and copies them', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'table:value_kinds');
  await detailToggle(page).click();
  await expect(detail(page)).toBeVisible();

  // The grid holds 1,000 characters of this; the panel asks the host for the rest.
  await cell(page, '12', 2).click();
  await expect(facts(page)).toHaveText('TEXT · 11,200 characters');
  await expect.poll(async () => (await shown(page, '.nl-detail-text'))?.length).toBe(11200);

  // The grid holds 48 bytes of this PNG; the panel shows the picture, and all 84 bytes in hex.
  await cell(page, '17', 2).click();
  await expect(facts(page)).toHaveText('BLOB · PNG · 84 B · 8 × 8 px');
  await expect(page.locator('.nl-detail-image img')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Image' })).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: `${SCREENS}/detail-image-dark.png` });
  await page.getByRole('radio', { name: 'Hex' }).click();
  await expect(facts(page)).toHaveText('BLOB · PNG · 84 B');
  await expect
    .poll(() => shown(page, '.nl-detail-hex'))
    .toMatch(
      /^00000000 {2}89 50 4e 47 0d 0a 1a 0a {2}\.PNG\.{4}\n00000008 {2}00 00 00 0d 49 48 44 52 {2}\.{4}IHDR\n/,
    );
  expect((await shown(page, '.nl-detail-hex'))?.split('\n')).toHaveLength(11);
  await page.screenshot({ path: `${SCREENS}/detail-blob-dark.png` });

  // The arrow keys switch between the views.
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('radio', { name: 'Image' })).toBeFocused();
  await expect(page.locator('.nl-detail-image img')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Hex' })).toBeFocused();

  // Hex, once picked, stays for the next picture; other BLOBs have no other view.
  await cell(page, '16', 2).click();
  await expect(facts(page)).toHaveText('BLOB · 0 B');
  await expect(page.locator('.nl-detail-views')).toBeHidden();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: 'Hex' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.nl-detail-hex')).toBeVisible();

  await page.keyboard.press('ArrowDown');
  await expect(facts(page)).toHaveText('NULL');
  await expect(page.locator('.nl-detail-body .nl-null')).toHaveText('NULL');

  await cell(page, '4', 2).click();
  await expect(facts(page)).toHaveText('INTEGER');
  expect(await shown(page, '.nl-detail-value')).toBe('9007199254740993');
  await page.getByRole('button', { name: 'Copy value' }).click();
  await expect(note(page)).toHaveText('Copied the value.');
  expect(viewer.clipboard.at(-1)).toBe('9007199254740993');

  // The panel stays open for the next table, and closes from its own button.
  await open(page, 'table:artists');
  await expect(page.locator('.nl-detail-title')).toHaveText('id');
  await expect(facts(page)).toHaveText('INTEGER');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(detail(page)).toBeHidden();
  await expect(detailToggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(grid(page)).toBeFocused();
  expect(viewer.problems).toEqual([]);
});

test('resizes the cell detail panel by its sash, and keeps the width', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'table:value_kinds');
  await detailToggle(page).click();
  const width = () => detail(page).evaluate((el) => el.getBoundingClientRect().width);
  // Within a pixel: widths are rounded as they're set.
  const near = (actual: number, expected: number) =>
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
  const before = await width();
  const sash = page.getByRole('separator', { name: 'Resize cell details' });
  const box = await sash.boundingBox();
  if (!box) throw new Error('No sash');
  await page.mouse.move(box.x + 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x - 98, box.y + 100, { steps: 4 });
  await page.mouse.up();
  near(await width(), before + 100);

  await sash.focus();
  await page.keyboard.press('ArrowRight');
  near(await width(), before + 80);

  await open(page, 'table:artists');
  await expect(detail(page)).toBeVisible();
  near(await width(), before + 80);
  expect(viewer.problems).toEqual([]);
});

test('shows text kept in a BLOB as text, with its hex dump a click away', async ({ page }) => {
  const folder = mkdtempSync(join(tmpdir(), 'nightlite-blobs-'));
  try {
    const path = join(folder, 'blobs.sqlite');
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body BLOB)');
    const text = (value: string) => new TextEncoder().encode(value);
    db.prepare('INSERT INTO notes (body) VALUES (?), (?)').run(
      text('{"name":"Gece","tags":["sqlite","mbtiles"],"zoom":14}'),
      text('İstanbul\nAnkara'),
    );
    db.close();

    const viewer = await openViewer(page, 'light');
    await viewer.load(path);
    await open(page, 'table:notes');
    await detailToggle(page).click();
    await cell(page, '1', 1).click();
    await expect(facts(page)).toHaveText('BLOB · 53 B');
    await expect(page.getByRole('radio', { name: 'Text' })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => shown(page, '.nl-detail-json')).toContain('"tags": [');
    await page.screenshot({ path: `${SCREENS}/detail-blob-text-light.png` });

    await page.keyboard.press('ArrowDown');
    await expect.poll(() => shown(page, '.nl-detail-text')).toBe('İstanbul\nAnkara');
    await page.getByRole('radio', { name: 'Hex' }).click();
    await expect.poll(() => shown(page, '.nl-detail-hex')).toMatch(/^00000000 {2}c4 b0 73 74/);
    expect(viewer.problems).toEqual([]);
  } finally {
    // Closing the page closes the database, which Windows won't let go of while it's open.
    await page.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
