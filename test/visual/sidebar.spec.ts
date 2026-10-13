import { expect, test, type Page } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

const item = (page: Page, key: string) => page.locator(`.nl-tree-item[data-key="${key}"]`);
const selected = (page: Page) => page.locator('.nl-tree-item[aria-selected="true"]');
const tab = (page: Page, name: 'Data' | 'Schema') => page.getByRole('tab', { name });
const grid = (page: Page, name: string) => page.locator(`.nl-grid[aria-label="Rows of ${name}"]`);

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test(`lists the database objects and shows one's schema (${theme})`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.load('sample.sqlite');

    await expect(page.locator('.nl-tree-group .nl-tree-label')).toHaveText([
      'Tables',
      'Views',
      'Indexes',
      'Triggers',
    ]);
    await expect(page.locator('.nl-tree-group .nl-badge')).toHaveText(['10', '1', '1', '1']);
    await expect(selected(page)).toHaveAttribute('data-key', 'overview');

    await item(page, 'table:albums').click();
    await tab(page, 'Schema').click();
    await expect(page.locator('.nl-object .nl-title')).toHaveText('albums');
    await expect(page.locator('.nl-traits')).toHaveText('Table');
    await expect(page.locator('.nl-sql-keyword').first()).toHaveText('CREATE');
    await expect(page.locator('.nl-sql')).toContainText('REFERENCES artists (id)');
    await page.screenshot({ path: `${SCREENS}/sidebar-${theme}.png` });
    expect(viewer.problems).toEqual([]);
  });
}

test('moves through the tree with the keyboard, as VS Code lists do', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');

  await item(page, 'overview').focus();
  await page.keyboard.press('ArrowDown'); // the Tables group
  await expect(page.locator('.nl-tree-item:focus')).toHaveAttribute('data-key', 'group:table');
  await expect(selected(page)).toHaveAttribute('data-key', 'overview');
  await page.keyboard.press('ArrowDown');
  await expect(selected(page)).toHaveAttribute('data-key', 'table:album_tags');
  await expect(grid(page, 'album_tags')).toBeVisible();

  // Left goes up to the group, then folds it; Right unfolds it again.
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.nl-tree-item:focus')).toHaveAttribute('data-key', 'group:table');
  await page.keyboard.press('ArrowLeft');
  await expect(item(page, 'group:table')).toHaveAttribute('aria-expanded', 'false');
  await expect(item(page, 'table:albums')).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(item(page, 'table:albums')).toBeVisible();

  // Typing jumps to a name.
  await page.keyboard.type('ev');
  await expect(selected(page)).toHaveAttribute('data-key', 'table:events');

  await page.keyboard.press('End');
  await expect(selected(page)).toHaveAttribute('data-key', 'trigger:albums_unrated');
  await expect(page.locator('.nl-traits')).toContainText('on albums');
  expect(viewer.problems).toEqual([]);
});

test('shows what Go to Table picked and puts the keyboard there', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await item(page, 'group:view').click(); // fold the group the object is in
  await viewer.post({ type: 'reveal', name: 'album_list' });

  await expect(selected(page)).toHaveAttribute('data-key', 'view:album_list');
  await expect(page.locator('.nl-tree-item:focus')).toHaveAttribute('data-key', 'view:album_list');
  await expect(grid(page, 'album_list')).toBeVisible();
});

test('keeps the shown object when the schema arrives again', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await item(page, 'table:artists').click();
  await viewer.load('sample.sqlite');
  await expect(selected(page)).toHaveAttribute('data-key', 'table:artists');
});

test('names the traits of a table', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await item(page, 'table:tags').click();
  await tab(page, 'Schema').click();
  await expect(page.locator('.nl-traits')).toHaveText(/Table.*WITHOUT ROWID/);
  await item(page, 'table:typed').click();
  await expect(page.locator('.nl-traits')).toHaveText(/Table.*STRICT/);

  await viewer.load('sample.gpkg');
  await expect(item(page, 'table:sqlite_sequence')).toHaveClass(/nl-muted/);
  await item(page, 'table:sqlite_sequence').click();
  await expect(page.locator('.nl-traits')).toContainText('SQLite internal');
});

test('says when a database has no tables', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('no-tables.sqlite');
  await expect(page.locator('.nl-tree-item')).toHaveCount(1);
  await expect(page.locator('.nl-sidebar-note')).toHaveText('This database has no tables yet.');
});

test('explains a database that could not be opened, under its header facts', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite', { schema: false });
  await viewer.post({
    type: 'schemaError',
    error: 'locked',
    detail: 'database is locked',
  });
  await expect(page.locator('.nl-sidebar')).toBeHidden();
  await expect(page.locator('.nl-overview')).toBeVisible();
  await expect(page.locator('.nl-error-title')).toHaveText("The database couldn't be opened");
  await expect(page.locator('.nl-error-message')).toContainText('Another program is writing');
  await expect(page.locator('.nl-error-detail')).toHaveText('database is locked');
  await page.screenshot({ path: `${SCREENS}/open-error-dark.png` });
});

test('keeps AAA text contrast for schemas in high-contrast themes', async ({ page }) => {
  for (const theme of ['hcDark', 'hcLight'] as ThemeName[]) {
    const viewer = await openViewer(page, theme);
    await viewer.load('sample.sqlite');
    await item(page, 'table:albums').click();
    await tab(page, 'Schema').click();
    expect(await lowestTextContrast(page), theme).toBeGreaterThanOrEqual(7);
  }
});
