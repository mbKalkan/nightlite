import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

/** The overview's row for a table: name, rows, columns. */
const sizeOf = (page: Page, name: string) =>
  page
    .locator('.nl-size-row')
    .filter({ has: page.getByRole('button', { name, exact: true }) })
    .locator('[role="cell"]');

for (const theme of ['dark', 'light'] as ThemeName[]) {
  test(`gives a database's tables and their sizes at a glance (${theme})`, async ({ page }) => {
    const viewer = await openViewer(page, theme);
    await viewer.load('sample.sqlite');

    await expect(page.locator('.nl-contents')).toHaveText('Tables 10Views 1Indexes 1Triggers 1');
    await expect(sizeOf(page, 'events')).toHaveText(['events', '5,000', '4', '']);
    await expect(sizeOf(page, 'albums')).toHaveText(['albums', '5', '8', '']);
    await expect(sizeOf(page, 'empty_table')).toHaveText(['empty_table', '0', '2', '']);
    await expect(page.locator('.nl-table-sizes .nl-note')).toHaveCount(0);
    await page.screenshot({ path: `${SCREENS}/database-overview-${theme}.png` });

    // A table's name opens it.
    await page.getByRole('button', { name: 'albums', exact: true }).click();
    await expect(page.locator('.nl-tree-item[aria-selected="true"]')).toHaveText(/albums/);
    await expect(page.locator('.nl-grid')).toBeVisible();
    expect(viewer.problems).toEqual([]);
  });
}

test('says the tables are being counted, and picks up where it stopped', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('sample.sqlite', { count: false });
  await expect(page.locator('.nl-table-sizes .nl-note')).toHaveText('Counting rows…');
  await expect(sizeOf(page, 'events')).toHaveText(['events', '…', '', '']);

  await page.locator('.nl-tree-item[data-key="table:artists"]').click();
  await page.locator('.nl-tree-item[data-key="overview"]').click();
  const asked = (await viewer.sent()).filter((message) => message.type === 'tableSummaries');
  expect(asked.length).toBeGreaterThanOrEqual(1);
  expect(viewer.problems).toEqual([]);
});
