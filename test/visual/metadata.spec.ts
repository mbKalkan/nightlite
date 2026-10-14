import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer, type HostOptions } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

const row = (page: Page, name: string) =>
  page
    .locator('.nl-metadata-row')
    .filter({ has: page.locator('.nl-metadata-key', { hasText: new RegExp(`^${name}$`) }) });
const field = (page: Page, name: string) => row(page, name).locator('.nl-metadata-value');
const keys = (page: Page) => page.locator('.nl-metadata-key');

async function openMetadata(
  page: Page,
  fixture = 'sample.mbtiles',
  theme: ThemeName = 'dark',
  options: HostOptions = {},
) {
  const viewer = await openViewer(page, theme);
  await viewer.load(fixture, options);
  await page.locator('.nl-tree-item[data-key="metadata"]').click();
  await expect(keys(page).first()).toBeVisible();
  return viewer;
}

/** The edits the webview sent, as [key, value, amend]. */
async function edits(viewer: Awaited<ReturnType<typeof openViewer>>) {
  return (await viewer.sent())
    .filter((message) => message.type === 'editMetadata')
    .map((message) => {
      const edit = message as unknown as { name: string; value: string | null; amend?: boolean };
      return [edit.name, edit.value, edit.amend ?? false];
    });
}

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test(`lists the metadata as a form (${theme})`, async ({ page }) => {
    const viewer = await openMetadata(page, 'sample.mbtiles', theme);
    await expect(keys(page)).toHaveText([
      'name',
      'description',
      'format',
      'type',
      'version',
      'minzoom',
      'maxzoom',
      'bounds',
      'center',
      'attribution',
      'json',
    ]);
    await expect(field(page, 'name')).toHaveValue('Sample tiles');
    await expect(field(page, 'json')).toHaveValue(/^\{"vector_layers"/);
    await expect(page.locator('.nl-metadata-row.nl-changed')).toHaveCount(0);
    await expect(page.locator('.nl-metadata-issue, .nl-metadata-hint')).toHaveCount(0);
    await expect(page.locator('.nl-metadata-note')).toContainText('Ctrl+S');
    await page.screenshot({ path: `${SCREENS}/metadata-${theme}.png`, fullPage: true });
    if (theme.startsWith('hc')) {
      expect(await lowestTextContrast(page)).toBeGreaterThanOrEqual(7);
    }
    expect(viewer.problems).toEqual([]);
  });
}

test('marks changed keys and checks values as they are typed', async ({ page }) => {
  const viewer = await openMetadata(page);
  const minzoom = field(page, 'minzoom');
  await minzoom.fill('');
  await minzoom.pressSequentially('5');
  await expect(row(page, 'minzoom')).toHaveClass(/nl-changed/);
  await expect(row(page, 'minzoom').locator('.nl-metadata-hint')).toHaveText(
    'The metadata says minzoom 5; the tiles start at zoom 0.',
  );
  await expect(row(page, 'minzoom').locator('.nl-metadata-issue')).toHaveText(
    'minzoom is above maxzoom.',
  );

  await minzoom.fill('x');
  await expect(row(page, 'minzoom').locator('.nl-metadata-issue')).toHaveText(
    'A whole number from 0 to 30.',
  );
  await expect(minzoom).toHaveAttribute('aria-invalid', 'true');

  await field(page, 'bounds').fill('-180,-85,180');
  await expect(row(page, 'bounds').locator('.nl-metadata-issue')).toHaveText(
    'Four numbers in degrees: west, south, east, north.',
  );
  await field(page, 'json').fill('[1, 2]');
  await expect(row(page, 'json').locator('.nl-metadata-issue')).toHaveText('Not a JSON object.');
  await page.screenshot({ path: `${SCREENS}/metadata-issues-dark.png`, fullPage: true });

  // The first keystroke in a field starts an edit; the ones after it amend that edit.
  expect((await edits(viewer)).slice(0, 4)).toEqual([
    ['minzoom', '', false],
    ['minzoom', '5', true],
    ['minzoom', 'x', true],
    ['bounds', '-180,-85,180', false],
  ]);
  expect(viewer.problems).toEqual([]);
});

test("undoes a field's typing as one, and keeps what's typed while answers arrive", async ({
  page,
}) => {
  const viewer = await openMetadata(page);
  const name = field(page, 'name');
  await name.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' plus more', { delay: 0 });
  await expect(name).toHaveValue('Sample tiles plus more');
  await expect(row(page, 'name')).toHaveClass(/nl-changed/);

  await viewer.undo();
  await expect(name).toHaveValue('Sample tiles');
  await expect(row(page, 'name')).not.toHaveClass(/nl-changed/);
  await viewer.redo();
  await expect(name).toHaveValue('Sample tiles plus more');

  // Typing after an undo starts a new edit, which undoes on its own.
  await viewer.undo();
  await name.click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await expect(name).toHaveValue('Sample tiles!');
  await viewer.undo();
  await expect(name).toHaveValue('Sample tiles');
  expect(viewer.problems).toEqual([]);
});

test('adds and removes keys', async ({ page }) => {
  const viewer = await openMetadata(page, 'raster.mbtiles');
  await expect(keys(page)).toHaveText(['name', 'format', 'type', 'minzoom', 'maxzoom', 'bounds']);
  // The standard keys missing are offered.
  const offered = await page
    .locator('#nl-metadata-keys option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(offered).toEqual(['description', 'version', 'center', 'attribution', 'json']);

  await page.locator('.nl-metadata-new').fill('center');
  await page.getByRole('button', { name: 'Add Key' }).click();
  await expect(keys(page).last()).toHaveText('center');
  await expect(field(page, 'center')).toBeFocused();
  await page.keyboard.type('0,0,1');
  await expect(row(page, 'center')).toHaveClass(/nl-changed/);
  await expect(row(page, 'center').locator('.nl-metadata-issue')).toHaveCount(0);

  await page.getByRole('button', { name: 'Remove type' }).click();
  await expect(keys(page)).toHaveText(['name', 'format', 'minzoom', 'maxzoom', 'bounds', 'center']);
  await viewer.undo();
  await expect(keys(page)).toContainText(['type']);
  expect(viewer.problems).toEqual([]);
});

test('saves the changes into the file, and the summary reads them', async ({ page }) => {
  const viewer = await openMetadata(page, 'sample.mbtiles', 'dark', { writable: true });
  await field(page, 'name').fill('Renamed tiles');
  await page.getByRole('button', { name: 'Remove attribution' }).click();
  await expect(page.locator('.nl-metadata-row.nl-changed')).toHaveCount(1);

  const written = await viewer.save();
  expect(written).toEqual([
    ['name', 'Renamed tiles'],
    ['attribution', null],
  ]);
  await expect(page.locator('.nl-metadata-row.nl-changed')).toHaveCount(0);
  await expect(field(page, 'name')).toHaveValue('Renamed tiles');
  await expect(keys(page)).not.toContainText(['attribution']);

  await page.locator('.nl-tree-item[data-key="overview"]').click();
  await expect(page.locator('.nl-title')).toHaveText('Renamed tiles');
  expect(viewer.problems).toEqual([]);
});
