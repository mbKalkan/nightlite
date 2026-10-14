import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';

// Records the short demo shown at the top of the README. Not part of the test run:
// `npm run demo` records it and turns it into docs/images/demo.gif (after
// `npm run fixtures:large`).
test.skip(!process.env.DEMO_VIDEO, 'run with npm run demo');
test.use({
  // Wide enough for the tile browser's layers beside the tile.
  viewport: { width: 1100, height: 640 },
  deviceScaleFactor: 1,
  video: { mode: 'on', size: { width: 1100, height: 640 } },
});

/** Moves the mouse to an element and clicks it, slowly enough to follow. */
async function clickSlowly(page: Page, selector: string, double = false) {
  const box = (await page.locator(selector).first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await page.waitForTimeout(250);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    clickCount: double ? 2 : 1,
  });
}

const item = (key: string) => `.nl-tree-item[data-key="${key}"]`;

test('demo', async ({ page }) => {
  test.skip(!existsSync('test/fixtures/generated/large.sqlite'), 'run npm run fixtures:large');
  test.setTimeout(120_000);
  const viewer = await openViewer(page, 'dark');

  // Ten million rows: down a few pages, then to the very last row at once.
  await viewer.load('generated/large.sqlite');
  await clickSlowly(page, item('table:measurements'));
  await expect(page.locator('.nl-status-counts')).toHaveText('10,000,000 rows · 4 columns');
  await page.locator('.nl-grid-row:not(.nl-grid-loading) .nl-grid-cell >> nth=4').click();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(300);
  }
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(1400);

  // A table sorted by a column, then searched.
  await viewer.load('sample.sqlite');
  await clickSlowly(page, item('table:albums'));
  await page.waitForTimeout(500);
  await page.locator('.nl-grid-head', { hasText: 'price' }).hover();
  await page.waitForTimeout(300);
  await clickSlowly(page, '.nl-grid-sort[aria-label="Sort by price"]');
  await page.waitForTimeout(900);
  await clickSlowly(page, '.nl-search-input');
  await page.keyboard.type('blue', { delay: 120 });
  await expect(page.locator('.nl-status-counts')).toHaveText('2 matching rows · 8 columns');
  await page.waitForTimeout(1200);

  // A query.
  await clickSlowly(page, item('query'));
  const editor = page.locator('.nl-query-editor');
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(
    'SELECT artists.name, count(*) AS albums, sum(price) AS total\nFROM albums JOIN artists ON artists.id = albums.artist_id\nGROUP BY artists.name ORDER BY total DESC',
    { delay: 18 },
  );
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.nl-query-status')).toHaveText(/^5 rows/);
  await page.waitForTimeout(1500);

  // A vector tile, and a building's attributes under the pointer.
  await viewer.load('showcase.mbtiles');
  await clickSlowly(page, item('tiles'));
  await expect(page.locator('.nl-tile-layer-name')).toHaveCount(5);
  await page.waitForTimeout(600);
  const box = (await page.locator('.nl-tile-overlay').boundingBox())!;
  // Find a building near the middle, as the README screenshot does, then point at it slowly.
  const cards = page.locator('.nl-tile-feature .nl-tile-layer-name');
  let building: { x: number; y: number } | undefined;
  search: for (let dy = 0.4; dy < 0.7; dy += 0.02) {
    for (let dx = 0.4; dx < 0.7; dx += 0.02) {
      await page.mouse.move(box.x + dx * box.width, box.y + dy * box.height);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
      if ((await cards.allTextContents()).join() === 'buildings') {
        building = { x: box.x + dx * box.width, y: box.y + dy * box.height };
        break search;
      }
    }
  }
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.25);
  await page.waitForTimeout(500);
  await page.mouse.move(building!.x, building!.y, { steps: 25 });
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(1500);

  // A GeoPackage's geometry, drawn.
  await viewer.load('sample.gpkg');
  await page.waitForTimeout(1200);
  await clickSlowly(page, item('table:regions'));
  await page.waitForTimeout(400);
  await clickSlowly(page, '.nl-grid-row:not(.nl-grid-loading) .nl-grid-cell >> nth=2', true);
  await expect(page.locator('.nl-detail-geometry canvas')).toBeVisible();
  await page.waitForTimeout(1800);
});
