// Renders assets/icon.svg to the PNG that the Marketplace and VS Code show.
// The SVG is the source; run `npm run icon` after changing it and commit both.
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const SIZE = 256;

const svg = readFileSync('assets/icon.svg', 'utf8');
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : undefined,
});
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
  await page.setContent(
    `<body style="margin:0">${svg.replace('<svg ', `<svg width="${SIZE}" height="${SIZE}" `)}</body>`,
  );
  await page.locator('svg').screenshot({ path: 'assets/icon.png', omitBackground: true });
  console.log(`wrote assets/icon.png (${SIZE}×${SIZE})`);
} finally {
  await browser.close();
}
