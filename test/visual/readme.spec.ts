import { existsSync, mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';

// Screenshots for the README and the Marketplace page, from the fixtures. Not part of the test
// run: `npm run screenshots` regenerates docs/images (after `npm run fixtures:large`).
const OUT = 'docs/images';

test.skip(!process.env.README_SCREENSHOTS, 'run with npm run screenshots');
test.use({ viewport: { width: 1200, height: 720 }, deviceScaleFactor: 1 });

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

const open = (page: Page, key: string) => page.locator(`.nl-tree-item[data-key="${key}"]`).click();
const cell = (page: Page, rowLabel: string, column: number) =>
  page
    .locator('.nl-grid-row')
    .filter({ has: page.locator('.nl-grid-rowhead', { hasText: new RegExp(`^${rowLabel}$`) }) })
    .locator('.nl-grid-cell')
    .nth(column + 1);

/** Lets the last frame and counts land, so no screenshot shows a half-drawn view. */
const settle = (page: Page) => page.waitForTimeout(300);

test('ten million rows, halfway down', async ({ page }) => {
  test.skip(!existsSync('test/fixtures/generated/large.sqlite'), 'run npm run fixtures:large');
  const viewer = await openViewer(page, 'dark');
  await viewer.load('generated/large.sqlite');
  await open(page, 'table:measurements');
  await expect(page.locator('.nl-status-counts')).toHaveText('10,000,000 rows · 4 columns');
  await page.locator('.nl-grid').evaluate((grid) => {
    grid.scrollTop = (grid.scrollHeight - grid.clientHeight) / 2;
  });
  await page.waitForTimeout(300);
  await page
    .locator('.nl-grid-row:not(.nl-grid-loading)')
    .nth(12)
    .locator('.nl-grid-cell')
    .nth(4)
    .click();
  await expect(page.locator('.nl-status-where')).toHaveText(/^rowid \d+ · value$/);
  await settle(page);
  await page.screenshot({ path: `${OUT}/rows-dark.png` });
});

test('a JSON value in the cell details', async ({ page }) => {
  // Wide enough for every column beside the panel.
  await page.setViewportSize({ width: 1440, height: 720 });
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'table:albums');
  await cell(page, '2', 6).dblclick();
  await expect(page.locator('.nl-detail-json')).toBeVisible();
  await page.locator('.nl-grid').focus();
  await settle(page);
  await page.screenshot({ path: `${OUT}/cell-details-dark.png` });
});

test('the same, in a light theme', async ({ page }) => {
  // Wide enough for every column beside the panel.
  await page.setViewportSize({ width: 1440, height: 720 });
  const viewer = await openViewer(page, 'light');
  await viewer.load('sample.sqlite');
  await open(page, 'table:albums');
  await cell(page, '2', 6).dblclick();
  await expect(page.locator('.nl-detail-json')).toBeVisible();
  await page.locator('.nl-grid').focus();
  await settle(page);
  await page.screenshot({ path: `${OUT}/cell-details-light.png` });
});

test('an MBTiles summary', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.mbtiles');
  await expect(page.locator('.nl-zooms .nl-note').first()).toHaveText('21 tiles at zoom 0–2');
  await settle(page);
  await page.screenshot({ path: `${OUT}/mbtiles-dark.png` });
});

test('a vector tile in the tile browser', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('showcase.mbtiles');
  await open(page, 'tiles');
  await expect(page.locator('.nl-tile-address')).toHaveText('14/9510/6142');
  await expect(page.locator('.nl-tile-layer-name')).toHaveCount(5);
  // Point at a building on its own, near the middle, and keep its attributes in view.
  const box = (await page.locator('.nl-tile-overlay').boundingBox())!;
  const cards = page.locator('.nl-tile-feature .nl-tile-layer-name');
  search: for (let dy = 0.4; dy < 0.7; dy += 0.02) {
    for (let dx = 0.4; dx < 0.7; dx += 0.02) {
      await page.mouse.move(box.x + dx * box.width, box.y + dy * box.height);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
      if ((await cards.allTextContents()).join() === 'buildings') break search;
    }
  }
  await expect(cards).toHaveText(['buildings']);
  await page.mouse.down();
  await page.mouse.up();
  await settle(page);
  await page.screenshot({ path: `${OUT}/tiles-dark.png` });
});

test("a database's overview", async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await expect(page.locator('.nl-size-row:not(.nl-pending)')).toHaveCount(11);
  await settle(page);
  await page.screenshot({ path: `${OUT}/overview-dark.png` });
});

test("a table's schema", async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'table:albums');
  await page.getByRole('tab', { name: 'Schema' }).click();
  await expect(page.locator('.nl-object-details .nl-heading')).toHaveCount(3);
  await settle(page);
  await page.screenshot({ path: `${OUT}/schema-dark.png` });
});

test('a query and its rows', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'query');
  const editor = page.getByRole('textbox', { name: 'SQL statement' });
  await editor.fill(
    [
      'SELECT artists.name AS artist, artists.country, albums.title, albums.released,',
      '       albums.price, albums.rating',
      'FROM albums JOIN artists ON artists.id = albums.artist_id',
      'ORDER BY albums.released;',
    ].join('\n'),
  );
  await editor.press('Control+Enter');
  await expect(page.locator('.nl-query-status')).toHaveText(/^5 rows/);
  await page.locator('.nl-grid').focus();
  await settle(page);
  await page.screenshot({ path: `${OUT}/query-dark.png` });
});

test("a GeoPackage's contents", async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.gpkg');
  await expect(page.locator('.nl-contents-row:not(.nl-contents-head)')).toHaveCount(5);
  await expect(page.locator('.nl-size-row.nl-pending')).toHaveCount(0);
  await settle(page);
  await page.screenshot({ path: `${OUT}/geopackage-dark.png` });
});
