import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const svg = await readFile('public/favicon-z96a.svg', 'utf8');
await mkdir('public/icons', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

for (const size of [16, 32, 180, 192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent;">${svg}</body></html>`);
  await page.screenshot({
    path: `public/icons/icon-${size}.png`,
    omitBackground: true,
  });
}

await browser.close();
