import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';

const open = (page: Page, key: string) => page.locator(`.nl-tree-item[data-key="${key}"]`).click();
const exportButton = (page: Page) => page.getByRole('button', { name: 'Export Rows…' });

test('exports a table’s rows as shown, sorted and searched', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'table:albums');
  await page.getByRole('textbox', { name: 'Search rows' }).fill('blue');
  await expect(page.locator('.nl-status-counts')).toHaveText('2 matching rows · 8 columns');
  await exportButton(page).click();
  await expect.poll(() => viewer.exported.length).toBe(1);
  const [exported] = viewer.exported;
  expect(exported.name).toBe('albums');
  expect(exported.source).toEqual({
    table: 'albums',
    view: { order: null, search: 'blue', filters: [] },
  });
  expect(exported.csv.split('\r\n').map((line) => line.split(',')[2])).toEqual([
    'title',
    'Pastel Blues',
    'Kind of Blue',
    undefined,
  ]);

  // Export Rows… from the Command Palette or the context menu does the same.
  await viewer.post({ type: 'exportRequest' });
  await expect.poll(() => viewer.exported.length).toBe(2);
  expect(viewer.problems).toEqual([]);
});

test('exports every row of a query, not only those kept for the grid', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite');
  await open(page, 'query');
  await expect(exportButton(page)).toBeHidden();
  const editor = page.getByRole('textbox', { name: 'SQL statement' });
  await editor.fill('SELECT id, kind FROM events WHERE id <= 3');
  await editor.press('Control+Enter');
  await expect(page.locator('.nl-query-status')).toHaveText(/^3 rows/);
  // Typed since, but not run: the export is of the rows shown.
  await editor.fill('SELECT 1');
  await exportButton(page).click();
  await expect.poll(() => viewer.exported.length).toBe(1);
  expect(viewer.exported[0].source).toEqual({ sql: 'SELECT id, kind FROM events WHERE id <= 3' });
  expect(JSON.parse(viewer.exported[0].json)).toHaveLength(3);
  expect(viewer.problems).toEqual([]);
});
