import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

const address = (page: Page) => page.locator('.nl-tile-address');
const facts = (page: Page) => page.locator('.nl-tile-facts');
const listRows = (page: Page) => page.locator('.nl-tile-row[role="option"]');
const selectedRow = (page: Page) => page.locator('.nl-tile-row[aria-selected="true"]');
const preview = (page: Page) => page.locator('.nl-tile-view');

async function openTiles(page: Page, fixture: string, theme: ThemeName = 'dark') {
  const viewer = await openViewer(page, theme);
  await viewer.load(fixture);
  await page.locator('.nl-tree-item', { hasText: 'Tile Browser' }).click();
  return viewer;
}

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test(`opens vector tiles at the tileset's center (${theme})`, async ({ page }) => {
    const viewer = await openTiles(page, 'sample.mbtiles', theme);

    // The metadata's center is 0,0 at zoom 1: the tile south-east of the middle.
    await expect(address(page)).toHaveText('1/1/1');
    await expect(page.locator('.nl-address')).toHaveValue('1/1/1');
    await expect(facts(page)).toHaveText(/^Vector tile · 3 layers · 4 features · \d+ B with gzip, \d+ B uncompressed$/);
    await expect(page.locator('.nl-tile-layer-name')).toHaveText(['places', 'roads', 'water']);
    await expect(page.locator('.nl-tile-layer-facts')).toHaveText(['2 points', '1 line', '1 polygon']);
    await expect(page.locator('.nl-select option')).toHaveText([
      '0 · 1 tile',
      '1 · 4 tiles',
      '2 · 16 tiles',
    ]);
    await expect(page.locator('.nl-select')).toHaveValue('1');

    // The list holds zoom 1 by column, then by row as stored, so XYZ rows count down.
    await expect(listRows(page)).toHaveText(['01', '00', '11', '10']);
    await expect(selectedRow(page)).toHaveText('11');

    // Something was drawn: the canvas isn't blank.
    const drawn = await page.locator('.nl-tile-canvas canvas').evaluate((canvas) => {
      const context = (canvas as HTMLCanvasElement).getContext('2d');
      const { data } = context!.getImageData(0, 0, canvas.clientWidth, canvas.clientHeight);
      let painted = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
      return painted;
    });
    expect(drawn).toBeGreaterThan(1000);

    await page.screenshot({ path: `${SCREENS}/tiles-vector-${theme}.png` });
    if (theme.startsWith('hc')) {
      expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(7);
    }
    expect(viewer.problems).toEqual([]);
  });
}

test('moves to neighboring tiles and between zoom levels with the keyboard', async ({ page }) => {
  const viewer = await openTiles(page, 'sample.mbtiles');
  await expect(address(page)).toHaveText('1/1/1');
  await preview(page).focus();

  await page.keyboard.press('ArrowLeft');
  await expect(address(page)).toHaveText('1/0/1');
  await expect(selectedRow(page)).toHaveText('01');
  await page.keyboard.press('ArrowUp');
  await expect(address(page)).toHaveText('1/0/0');
  await expect(selectedRow(page)).toHaveText('00');

  // The world ends to the west and the north: those buttons are off.
  await expect(page.getByRole('button', { name: 'West' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'North' })).toBeDisabled();
  await page.keyboard.press('ArrowLeft');
  await expect(address(page)).toHaveText('1/0/0');

  // Zooming in goes to the north-west quarter; out, to the tile holding this one.
  await page.keyboard.press('+');
  await expect(address(page)).toHaveText('2/0/0');
  await expect(page.locator('.nl-select')).toHaveValue('2');
  await expect(listRows(page)).toHaveCount(16);
  await expect(selectedRow(page)).toHaveText('00');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(address(page)).toHaveText('2/1/1');
  await page.keyboard.press('-');
  await expect(address(page)).toHaveText('1/0/0');

  // The buttons do the same.
  await page.getByRole('button', { name: 'East' }).click();
  await expect(address(page)).toHaveText('1/1/0');
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect(address(page)).toHaveText('0/0/0');
  await expect(page.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
  expect(viewer.problems).toEqual([]);
});

test('picks tiles from the list', async ({ page }) => {
  const viewer = await openTiles(page, 'sample.mbtiles');
  await page.locator('.nl-select').selectOption('2');
  // From 1/1/1, zoom 2 starts at its north-west quarter.
  await expect(address(page)).toHaveText('2/2/2');
  await expect(listRows(page)).toHaveCount(16);

  await listRows(page).first().click();
  await expect(address(page)).toHaveText('2/0/3');
  await page.keyboard.press('ArrowDown');
  await expect(address(page)).toHaveText('2/0/2');
  await page.keyboard.press('End');
  await expect(address(page)).toHaveText('2/3/0');
  await expect(selectedRow(page)).toHaveText('30');
  expect(viewer.problems).toEqual([]);
});

test('goes to a typed tile, a pasted tile URL, or says why it can’t', async ({ page }) => {
  const viewer = await openTiles(page, 'sample.mbtiles');
  const box = page.locator('.nl-address');

  await box.fill('2/3/1');
  await box.press('Enter');
  await expect(address(page)).toHaveText('2/3/1');
  await expect(preview(page)).toBeFocused();

  await box.fill('https://tiles.example.com/v1/2/1/3.pbf?key=abc');
  await box.press('Enter');
  await expect(address(page)).toHaveText('2/1/3');
  await expect(box).toHaveValue('2/1/3');

  await box.fill('2/9/1');
  await box.press('Enter');
  await expect(box).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.nl-address-note')).toHaveText(
    'Type a tile as z/x/y, like 14/8723/5412.',
  );
  await page.screenshot({ path: `${SCREENS}/tiles-invalid-dark.png` });
  await box.press('Escape');
  await expect(box).toHaveValue('2/1/3');
  await expect(box).toHaveAttribute('aria-invalid', 'false');

  // A zoom level with no tiles says so, in the list and in the preview.
  await box.fill('5/0/0');
  await box.press('Enter');
  await expect(page.locator('.nl-tile-message strong')).toHaveText([
    'There are no tiles.',
    'There is no tile at 5/0/0.',
  ]);
  expect(viewer.problems).toEqual([]);
});

test('numbers rows the TMS way when asked', async ({ page }) => {
  const viewer = await openTiles(page, 'sample.mbtiles');
  await page.getByRole('radio', { name: 'TMS' }).click();
  await expect(address(page)).toHaveText('1/1/0');
  await expect(listRows(page)).toHaveText(['00', '01', '10', '11']);
  await expect(selectedRow(page)).toHaveText('10');

  const box = page.locator('.nl-address');
  await box.fill('1/0/1');
  await box.press('Enter');
  // TMS row 1 at zoom 1 is the northern one.
  await expect(selectedRow(page)).toHaveText('01');
  await page.getByRole('radio', { name: 'XYZ' }).click();
  await expect(address(page)).toHaveText('1/0/0');
  expect(viewer.problems).toEqual([]);
});

test('hides layers from tile to tile', async ({ page }) => {
  const viewer = await openTiles(page, 'sample.mbtiles');
  const roads = page.getByRole('checkbox', { name: 'roads' });
  await expect(roads).toBeChecked();
  await roads.uncheck();
  await preview(page).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(address(page)).toHaveText('1/0/1');
  await expect(page.getByRole('checkbox', { name: 'roads' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'places' })).toBeChecked();
  expect(viewer.problems).toEqual([]);
});

test('shows raster tiles as images, starting at the first tile', async ({ page }) => {
  const viewer = await openTiles(page, 'raster.mbtiles');
  // No center in the metadata: the first tile of the lowest zoom level.
  await expect(address(page)).toHaveText('0/0/0');
  await expect(facts(page)).toHaveText(/^PNG image · 256 × 256 px · [\d.,]+ (B|KB)$/);
  await expect(page.locator('.nl-tile-image img')).toBeVisible();
  await expect(page.locator('.nl-tile-layers')).toHaveCount(0);
  await page.screenshot({ path: `${SCREENS}/tiles-raster-dark.png` });
  expect(viewer.problems).toEqual([]);
});

test('opens the tile browser at a zoom level from the summary', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.mbtiles');
  await page.locator('.nl-zoom-level .nl-link', { hasText: '2' }).click();
  await expect(page.locator('.nl-tree-item[aria-selected="true"]')).toHaveText('Tile Browser');
  await expect(page.locator('.nl-select')).toHaveValue('2');
  await expect(address(page)).toHaveText('2/2/2');
  expect(viewer.problems).toEqual([]);
});

test('reads tilesets whose tiles are a view over shared images', async ({ page }) => {
  const viewer = await openTiles(page, 'dedup.mbtiles');
  // No center: the first tile of zoom 0, then the four tiles of zoom 1 share one image.
  await expect(address(page)).toHaveText('0/0/0');
  await expect(facts(page)).toHaveText(/^Vector tile · 3 layers · 4 features/);
  await page.locator('.nl-select').selectOption('1');
  await expect(address(page)).toHaveText('1/0/0');
  await expect(listRows(page)).toHaveCount(4);
  expect(viewer.problems).toEqual([]);
});
