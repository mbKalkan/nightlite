import { copyFileSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type Page } from '@playwright/test';
import { openViewer } from './harness';

const open = (page: Page, key: string) => page.locator(`.nl-tree-item[data-key="${key}"]`).click();
const counts = (page: Page) => page.locator('.nl-status-counts');
const where = (page: Page) => page.locator('.nl-status-where');
const firstRow = (page: Page) =>
  page.locator('.nl-grid-row:not(.nl-grid-loading) .nl-grid-rowhead').nth(8);

test('comes back to the same rows and cell when the file changes', async ({ page }, info) => {
  // A copy of its own to change, in the ignored folder for generated files.
  mkdirSync('test/fixtures/generated', { recursive: true });
  const name = `generated/reload-${info.workerIndex}.sqlite`;
  const path = `test/fixtures/${name}`;
  copyFileSync('test/fixtures/sample.sqlite', path);

  const viewer = await openViewer(page, 'dark');
  await viewer.load(name);
  await open(page, 'table:events');
  await expect(counts(page)).toHaveText('5,000 rows · 4 columns');
  await page.locator('.nl-grid-row').nth(2).locator('.nl-grid-cell').nth(2).click();
  for (let i = 0; i < 4; i++) await page.keyboard.press('PageDown');
  await expect(where(page)).toHaveText(/^rowid \d+ · at$/);
  // The rows redraw on the next frame.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const cell = await where(page).textContent();
  const top = await firstRow(page).textContent();

  // Another program adds rows; the extension host loads the file again.
  const writer = new DatabaseSync(path);
  writer.exec(
    "INSERT INTO events (at, kind, amount) SELECT '2026-01-01', 'added', 1 FROM events LIMIT 10",
  );
  writer.close();
  await viewer.load(name);

  await expect(counts(page)).toHaveText('5,010 rows · 4 columns');
  await expect(where(page)).toHaveText(cell ?? '');
  await expect(firstRow(page)).toHaveText(top ?? '');
  await expect(page.locator('.nl-tree-item[aria-selected="true"]')).toHaveText(/events/);

  // Each table keeps its place while others are shown.
  await open(page, 'table:artists');
  await open(page, 'table:events');
  await expect(where(page)).toHaveText(cell ?? '');
  expect(viewer.problems).toEqual([]);
});
