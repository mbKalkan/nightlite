import { expect, test } from '@playwright/test';
import { lowestTextContrast } from './contrast';
import { openViewer } from './harness';
import type { ThemeName } from './themes';

const SCREENS = 'test-results/screens';

for (const theme of ['dark', 'light', 'hcDark', 'hcLight'] as ThemeName[]) {
  test.describe(`${theme} theme`, () => {
    test('describes a database from its header', async ({ page }) => {
      const viewer = await openViewer(page, theme);
      await viewer.load('sample.gpkg');

      await expect(page.locator('.nl-file-name')).toHaveText('sample.gpkg');
      await expect(page.locator('.nl-title')).toHaveText('GeoPackage');
      await expect(page.locator('.nl-facts dt')).toContainText([
        'File size',
        'Pages',
        'Text encoding',
        'Journal',
        'User version',
        'Application ID',
        'Last written by',
      ]);
      await expect(page.locator('.nl-facts dd').nth(5)).toHaveText('GPKG (0x47504b47)');
      await page.screenshot({ path: `${SCREENS}/overview-${theme}.png` });
      expect(viewer.problems).toEqual([]);
    });

    test('explains a file it cannot open', async ({ page }) => {
      const viewer = await openViewer(page, theme);
      await viewer.load('not-sqlite.sqlite');

      await expect(page.locator('.nl-error-title')).toHaveText("This file can't be displayed");
      await expect(page.locator('.nl-error-message')).toContainText("isn't a SQLite database");
      // A .db file can be anything; VS Code's own picker opens it in another editor.
      await page.getByRole('button', { name: 'Reopen With…' }).click();
      expect((await viewer.sent()).some((message) => message.type === 'reopenWith')).toBe(true);
      await page.screenshot({ path: `${SCREENS}/not-sqlite-${theme}.png` });
      expect(viewer.problems).toEqual([]);
    });
  });
}

test('keeps AAA text contrast in high-contrast themes', async ({ page }) => {
  for (const theme of ['hcDark', 'hcLight'] as ThemeName[]) {
    const viewer = await openViewer(page, theme);
    await viewer.load('sample.gpkg');
    expect(await lowestTextContrast(page), theme).toBeGreaterThanOrEqual(7);
  }
});

test('says when a file is empty', async ({ page }) => {
  const viewer = await openViewer(page, 'dark');
  await viewer.load('empty.sqlite');
  await expect(page.locator('.nl-error-message')).toHaveText('The file is empty.');
});

test('shows progress only when loading takes a while', async ({ page }) => {
  await openViewer(page, 'dark');
  await expect(page.locator('.nl-content')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.nl-progress')).toBeVisible();
});
