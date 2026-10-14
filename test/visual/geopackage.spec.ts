import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';

const SCREENS = 'test-results/screens';

const open = (page: Page, key: string) => page.locator(`.nl-tree-item[data-key="${key}"]`).click();
/** A cell of the first row: column 0 is the fid. */
const cell = (page: Page, row: number, column: number) =>
  page
    .locator('.nl-grid-row:not(.nl-grid-loading)')
    .nth(row)
    .locator('.nl-grid-cell')
    .nth(column + 1);
const facts = (page: Page) => page.locator('.nl-detail-facts');

for (const theme of ['dark', 'light'] as const) {
  test(`draws a GeoPackage geometry, and writes it as WKT (${theme})`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.load('sample.gpkg');
    await open(page, 'table:regions');
    // The grid says what each geometry is.
    await expect(cell(page, 0, 1)).toHaveText(/^MULTIPOLYGON · \d+ B$/);
    await cell(page, 0, 1).dblclick();
    await expect(facts(page)).toHaveText(
      /^BLOB · GeoPackage geometry · \d+ B · MULTIPOLYGON · SRS 4326 · 11 points$/,
    );
    await expect(page.getByRole('radio', { name: 'Geometry' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.locator('.nl-detail-geometry canvas')).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/geometry-${theme}.png` });

    await page.getByRole('radio', { name: 'WKT' }).click();
    await expect(page.locator('.nl-detail-body pre')).toHaveText(
      /^MULTIPOLYGON \(\(\(26 40, 29\.9 39\.9, .+\), \(29\.2 40\.6, .+\)\)\)$/,
    );
    expect(viewer.problems).toEqual([]);
  });
}

test('names points and lines, and steps through views with the arrow keys', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.gpkg');
  await open(page, 'table:cities');
  await expect(cell(page, 0, 1)).toHaveText('POINT · 29 B');
  await open(page, 'table:routes');
  await expect(cell(page, 0, 1)).toHaveText(/^LINESTRING · \d+ B$/);
  await cell(page, 0, 1).dblclick();
  await expect(facts(page)).toContainText('LINESTRING · SRS 4326 · 3 points');
  await page.getByRole('radio', { name: 'Geometry' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'WKT' })).toBeFocused();
  await expect(page.locator('.nl-detail-body pre')).toHaveText(
    'LINESTRING (28.9784 41.0082, 32.8597 39.9334, 27.1428 38.4237)',
  );
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Hex' })).toBeFocused();
  await expect(page.locator('.nl-detail-hex')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Geometry' })).toBeFocused();
  expect(viewer.problems).toEqual([]);
});
