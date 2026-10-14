import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';

const SCREENS = 'test-results/screens';

const open = (page: Page, key: string) => page.locator(`.nl-tree-item[data-key="${key}"]`).click();
const editor = (page: Page) => page.getByRole('textbox', { name: 'SQL statement' });
const status = (page: Page) => page.locator('.nl-query-status');
const results = (page: Page) => page.locator('.nl-query-results');
const grid = (page: Page) => page.getByRole('grid', { name: 'Query results' });
const rows = (page: Page) => grid(page).locator('.nl-grid-row');

async function runQuery(page: Page, sql: string) {
  await editor(page).fill(sql);
  await editor(page).press('Control+Enter');
}

for (const theme of ['dark', 'light'] as const) {
  test(`runs a query and shows its rows as tables show theirs (${theme})`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.load('sample.sqlite');
    // The first statement reads the table last shown.
    await open(page, 'table:albums');
    await open(page, 'query');
    await expect(editor(page)).toHaveValue('SELECT * FROM "albums" LIMIT 100;');
    await runQuery(
      page,
      [
        'SELECT albums.title, artists.name AS artist, albums.released, albums.price',
        'FROM albums JOIN artists ON artists.id = albums.artist_id',
        'ORDER BY albums.released',
      ].join('\n'),
    );
    await expect(status(page)).toHaveText(/^5 rows · \d+ ms$/);
    await expect(rows(page)).toHaveCount(5);
    await expect(grid(page).locator('.nl-grid-header')).toContainText('artist');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${SCREENS}/query-${theme}.png` });
    expect(viewer.problems).toEqual([]);
  });
}

test('copies and shows the cells of a query in full', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'query');
  await runQuery(page, "SELECT label, value FROM value_kinds WHERE label LIKE '%text%'");
  await expect(status(page)).toHaveText(/^4 rows/);
  // The long text: the grid holds a part, the panel and the copy all of it.
  await rows(page).nth(3).locator('.nl-grid-cell').nth(2).click();
  await page.keyboard.press('Control+c');
  await expect(page.locator('.nl-status-note')).toHaveText('Copied the value.');
  expect(viewer.clipboard.at(-1)).toHaveLength(11200);
  await page.locator('.nl-detail-toggle').click();
  await expect(page.locator('.nl-detail-facts')).toHaveText('TEXT · 11,200 characters');

  // Results stay while other pages are shown.
  await open(page, 'table:artists');
  await open(page, 'query');
  await expect(rows(page)).toHaveCount(4);
  await expect(editor(page)).toHaveValue(/^SELECT label, value/);
  expect(viewer.problems).toEqual([]);
});

test('runs only statements that read, and says what SQLite found wrong', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  // Open SQL Query, from the Command Palette.
  await viewer.post({ type: 'openQuery' });
  await expect(editor(page)).toBeFocused();
  await expect(page.locator('.nl-tree-item[aria-selected="true"]')).toHaveAttribute(
    'data-key',
    'query',
  );

  await runQuery(page, 'DELETE FROM albums');
  await expect(results(page)).toContainText('Nightlite runs only statements that read');
  await runQuery(page, "SELECT 1; VACUUM INTO 'copy.db'");
  await expect(results(page)).toContainText('Run one statement at a time.');
  // Neither went to the host.
  expect((await viewer.sent()).filter((message) => message.type === 'runQuery')).toEqual([]);

  await runQuery(page, 'SELECT * FROM missing');
  await expect(results(page)).toContainText("The query couldn't run");
  await expect(results(page)).toContainText('no such table: missing');

  await runQuery(page, 'SELECT * FROM albums WHERE 0');
  await expect(grid(page)).toContainText('The query returned no rows.');
  await expect(status(page)).toHaveText(/^0 rows/);
  expect(viewer.problems).toEqual([]);
});

const ENDLESS = 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT i FROM n';

test('stops a query, keeping the rows it read', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'query');
  viewer.slowQueries(20);
  await runQuery(page, ENDLESS);
  await expect(status(page)).toHaveText(/^Running… [\d,]+ rows$/);
  await editor(page).press('Escape');
  await expect(status(page)).toHaveText(/^Stopped · [\d,]+ rows · /);
  await expect(page.getByRole('button', { name: 'Run' })).toBeVisible();
  await expect(rows(page).first()).toContainText('1');

  // A step SQLite doesn't finish in time ends the worker, and the rows with it.
  viewer.slowQueries(2000);
  await page.getByRole('button', { name: 'Run' }).click();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(results(page)).toContainText('The query was stopped before it returned its rows.');
  expect(viewer.problems).toEqual([]);
});

test('says when results hold only the first rows', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'query');
  await runQuery(page, ENDLESS);
  await expect(status(page)).toHaveText(
    /^100,000 rows · .+ — Showing the first 100,000 rows: query results hold at most 100,000 rows or 256 MB\.$/,
  );
  await grid(page).press('Control+End');
  await expect(rows(page).last()).toContainText('100000');
  expect(viewer.problems).toEqual([]);
});
