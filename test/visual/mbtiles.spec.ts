import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

const zoomRows = (page: Page) => page.locator('.nl-zoom-row:not(.nl-zoom-head)');
const zoomNote = (page: Page) => page.locator('.nl-zooms .nl-note').first();
const fact = (page: Page, term: string) =>
  page.locator('.nl-facts dt', { hasText: new RegExp(`^${term}$`) }).locator('+ dd');

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test(`opens a tileset on its summary (${theme})`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.load('sample.mbtiles');

    await expect(page.locator('.nl-title')).toHaveText('Sample tiles');
    await expect(page.locator('.nl-subtitle')).toHaveText('MBTiles tileset · vector tiles');
    await expect(page.locator('.nl-description')).toHaveText('Places, roads and water for tests');

    await expect(zoomRows(page)).toHaveCount(3);
    await expect(zoomRows(page).locator('.nl-zoom-count')).toHaveText(['1', '4', '16']);
    await expect(zoomNote(page)).toHaveText('21 tiles at zoom 0–2');

    await expect(page.locator('.nl-layer-name')).toHaveText(['places', 'roads', 'water']);
    const places = page.locator('.nl-layer').first();
    await expect(places.locator('.nl-layer-facts')).toHaveText('zoom 0–2');
    await expect(places.locator('.nl-layer-description')).toHaveText('Named points');
    await expect(places.locator('.nl-field-name')).toHaveText(['name', 'population', 'capital']);

    await expect(fact(page, 'Format')).toHaveText('pbf (vector tiles)');
    await expect(fact(page, 'Zoom levels')).toHaveText('0–2');
    await expect(fact(page, 'Bounds')).toHaveText(
      'W -180 · S -85.05112878 · E 180 · N 85.05112878',
    );
    await expect(fact(page, 'Center')).toHaveText('lon 0 · lat 0 · zoom 1');
    await expect(fact(page, 'Application ID')).toHaveText('MPBX (0x4d504258)');
    await expect(page.locator('.nl-warning')).toHaveCount(0);
    await page.screenshot({ path: `${SCREENS}/mbtiles-${theme}.png`, fullPage: true });
    if (theme.startsWith('hc')) {
      expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(7);
    }
    expect(viewer.problems).toEqual([]);
  });
}

test('flags metadata the tiles contradict or leave out', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('dedup.mbtiles');

  await expect(page.locator('.nl-title')).toHaveText('Deduplicated tiles');
  await expect(zoomRows(page).locator('.nl-zoom-count')).toHaveText(['1', '4']);
  await expect(page.locator('.nl-warning')).toHaveText([
    'The metadata says maxzoom 5; the tiles go up to zoom 1.',
    'Missing: bounds, center, minzoom, json',
  ]);
  await expect(page.locator('.nl-zooms')).toContainText(
    'Deduplicated: tiles is a view over shared images.',
  );
  await page.screenshot({ path: `${SCREENS}/mbtiles-dedup-dark.png`, fullPage: true });
  expect(viewer.problems).toEqual([]);
});

test('describes raster tilesets without vector layers', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('raster.mbtiles');
  await expect(page.locator('.nl-subtitle')).toHaveText('MBTiles tileset · raster tiles');
  await expect(page.locator('.nl-layers')).toHaveCount(0);
  await expect(zoomNote(page)).toHaveText('5 tiles at zoom 0–1');
  await expect(page.locator('.nl-warning')).toHaveText(['Missing: center']);
});

test('shows tile counts as they arrive, and picks up where it stopped', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.mbtiles', { count: false });
  await expect(page.locator('.nl-title')).toHaveText('Sample tiles');
  await expect(zoomNote(page)).toHaveText('Counting tiles…');

  // Opening a table, then coming back, asks again for the levels not yet counted.
  await page.locator('.nl-tree-item[data-key="table:metadata"]').click();
  await page.locator('.nl-tree-item[data-key="overview"]').click();
  const asked = (await viewer.sent()).filter((message) => message.type === 'zoomCounts');
  expect(asked.length).toBeGreaterThanOrEqual(1);
  expect(viewer.problems).toEqual([]);
});
