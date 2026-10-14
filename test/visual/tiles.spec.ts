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
    await expect(facts(page)).toHaveText(
      /^Vector tile · 3 layers · 4 features · \d+ B with gzip, \d+ B uncompressed$/,
    );
    await expect(page.locator('.nl-tile-layer-name')).toHaveText(['places', 'roads', 'water']);
    await expect(page.locator('.nl-tile-layer-facts')).toHaveText([
      '2 points',
      '1 line',
      '1 polygon',
    ]);
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
    const drawn = await page
      .locator('.nl-tile-canvas canvas')
      .first()
      .evaluate((canvas) => {
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

test('puts the layers under the drawing in a narrow editor', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 760 });
  const viewer = await openTiles(page, 'sample.mbtiles');
  await expect(page.locator('.nl-tile-layer-name')).toHaveCount(3);
  const drawing = await page.locator('.nl-tile-canvas').boundingBox();
  const layers = await page.locator('.nl-tile-layers').boundingBox();
  expect(layers!.y).toBeGreaterThan(drawing!.y + drawing!.height);
  expect(drawing!.width).toBeGreaterThanOrEqual(240);
  await page.screenshot({ path: `${SCREENS}/tiles-narrow-dark.png` });
  expect(viewer.problems).toEqual([]);
});

test('asks once where a tile is in the list', async ({ page }) => {
  const viewer = await openTiles(page, 'sample.mbtiles');
  await expect(selectedRow(page)).toHaveText('11');
  const box = page.locator('.nl-address');
  await box.fill('2/3/1');
  await box.press('Enter');
  await expect(selectedRow(page)).toHaveText('31');
  const asked = (await viewer.sent()).filter(
    (message) => message.type === 'locateTile' && JSON.stringify(message).includes('"zoom":2'),
  );
  expect(asked).toHaveLength(1);
  expect(viewer.problems).toEqual([]);
});

/** Moves the mouse over a place of the drawn tile, in tile units (0–4096). */
async function pointAt(page: Page, x: number, y: number) {
  const box = (await page.locator('.nl-tile-overlay').boundingBox())!;
  const pad = Math.round(box.width / 16);
  const scale = (box.width - 2 * pad) / 4096;
  await page.mouse.move(box.x + pad + x * scale, box.y + pad + y * scale);
}

const featureCards = (page: Page) => page.locator('.nl-tile-feature');
const attributes = (page: Page) =>
  page.locator('.nl-tile-attributes').first().locator('dt, .nl-attribute-value');

test('shows the attributes of the features under the pointer', async ({ page }) => {
  const viewer = await openTiles(page, 'sample.mbtiles');
  await expect(address(page)).toHaveText('1/1/1');
  await expect(page.locator('.nl-tile-feature-list')).toContainText('Point at a feature');

  // Inside the lake, away from the place in it.
  await pointAt(page, 800, 800);
  await expect(featureCards(page)).toHaveCount(1);
  await expect(featureCards(page).locator('.nl-tile-feature-head')).toHaveText(
    'waterPolygon · id 20',
  );
  await expect(attributes(page)).toHaveText(['kind', 'lake', 'area', '1.5']);
  await expect(page.locator('.nl-attribute-type')).toHaveText(['string', 'double']);
  await expect(page.locator('.nl-tile-overlay')).toHaveClass(/nl-pointing/);
  const lit = await page.locator('.nl-tile-overlay').evaluate((canvas) => {
    const context = (canvas as HTMLCanvasElement).getContext('2d')!;
    const { data } = context.getImageData(0, 0, canvas.clientWidth, canvas.clientHeight);
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
    return painted;
  });
  expect(lit).toBeGreaterThan(1000);
  await page.screenshot({ path: `${SCREENS}/tiles-inspect-dark.png` });

  // The place inside the lake is on top of it.
  await pointAt(page, 1101, 1200);
  await expect(featureCards(page).locator('.nl-tile-layer-name')).toHaveText(['places', 'water']);
  await expect(attributes(page)).toHaveText([
    'name',
    'Place 1/1/1',
    'population',
    '2000',
    'capital',
    'false',
  ]);

  // Empty space shows the hint again.
  await pointAt(page, 3500, 3800);
  await expect(featureCards(page)).toHaveCount(0);
  expect(viewer.problems).toEqual([]);
});

test('keeps features in view with a click, and steps through them with [ and ]', async ({
  page,
}) => {
  const viewer = await openTiles(page, 'sample.mbtiles');
  await pointAt(page, 800, 800);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('.nl-tile-feature-list')).toHaveClass(/nl-pinned/);
  await pointAt(page, 3500, 3800);
  await expect(featureCards(page).locator('.nl-tile-layer-name')).toHaveText(['water']);

  // Escape lets go.
  await page.keyboard.press('Escape');
  await expect(featureCards(page)).toHaveCount(0);

  // The topmost feature first: the places, then the road, then the lake.
  await preview(page).focus();
  await page.keyboard.press(']');
  await expect(attributes(page).nth(1)).toHaveText('Köprübaşı');
  await page.keyboard.press(']');
  await expect(attributes(page).nth(1)).toHaveText('Place 1/1/1');
  await page.keyboard.press(']');
  await expect(featureCards(page).locator('.nl-tile-layer-name')).toHaveText(['roads']);
  await page.keyboard.press('[');
  await expect(attributes(page).nth(1)).toHaveText('Place 1/1/1');

  // Moving to another tile starts afresh there.
  await page.keyboard.press('ArrowLeft');
  await expect(address(page)).toHaveText('1/0/1');
  await expect(featureCards(page)).toHaveCount(0);
  expect(viewer.problems).toEqual([]);
});

test('leaves hidden layers out of what is under the pointer', async ({ page }) => {
  const viewer = await openTiles(page, 'sample.mbtiles');
  await page.getByRole('checkbox', { name: 'places' }).uncheck();
  await pointAt(page, 1101, 1200);
  await expect(featureCards(page).locator('.nl-tile-layer-name')).toHaveText(['water']);
  expect(viewer.problems).toEqual([]);
});

test('saves the tile shown, named by its address', async ({ page }) => {
  const viewer = await openTiles(page, 'sample.mbtiles');
  const save = page.getByRole('button', { name: 'Save Tile…' });
  await expect(address(page)).toHaveText('1/1/1');
  await save.click();
  await expect.poll(() => viewer.saved.length).toBe(1);
  expect(viewer.saved[0].name).toBe('1-1-1.pbf');
  // Uncompressed: a vector tile's first field is its first layer.
  expect(viewer.saved[0].bytes[0]).toBe(0x1a);

  await page.getByRole('radio', { name: 'TMS' }).click();
  await save.click();
  await expect.poll(() => viewer.saved.length).toBe(2);
  expect(viewer.saved[1].name).toBe('1-1-0.pbf');

  // Nothing to save where there's no tile.
  const box = page.locator('.nl-address');
  await box.fill('5/0/0');
  await box.press('Enter');
  await expect(page.locator('.nl-tile-view .nl-tile-message')).toBeVisible();
  await expect(save).toBeDisabled();
  expect(viewer.problems).toEqual([]);
});

test('saves raster tiles as the images they are', async ({ page }) => {
  const viewer = await openTiles(page, 'raster.mbtiles');
  await expect(address(page)).toHaveText('0/0/0');
  await page.getByRole('button', { name: 'Save Tile…' }).click();
  await expect.poll(() => viewer.saved.length).toBe(1);
  expect(viewer.saved[0].name).toBe('0-0-0.png');
  expect([...viewer.saved[0].bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(viewer.problems).toEqual([]);
});
