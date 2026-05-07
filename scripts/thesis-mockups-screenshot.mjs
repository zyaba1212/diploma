/**
 * Сохраняет PNG макетов главы 2.2 (1920×1080) из public/thesis-mockups/*.html
 * Требуется: npm i -D playwright && npx playwright install chromium
 */
import { mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const mockDir = path.join(root, 'public', 'thesis-mockups');

const PAGES = [
  { html: 'fig-2-1-main-page.html', png: 'fig-2-1-main-page.png' },
  { html: 'fig-2-2-global-network.html', png: 'fig-2-2-global-network.png' },
  { html: 'fig-2-3-sandbox.html', png: 'fig-2-3-sandbox.png' },
  { html: 'fig-2-4-proposals.html', png: 'fig-2-4-proposals.png' },
  { html: 'fig-2-5-news.html', png: 'fig-2-5-news.png' },
  { html: 'fig-2-6-admin-dashboard.html', png: 'fig-2-6-admin-dashboard.png' },
];

async function main() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error(
      'Не найден пакет playwright. Установите:\n  npm i -D playwright\n  npx playwright install chromium',
    );
    process.exit(1);
  }

  await mkdir(mockDir, { recursive: true });
  for (const { html } of PAGES) {
    await access(path.join(mockDir, html));
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  for (const { html, png } of PAGES) {
    const filePath = path.join(mockDir, html);
    const url = pathToFileURL(filePath).href;
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    await page.locator('.tm-viewport').waitFor({ state: 'visible', timeout: 10_000 });
    // Google Fonts по file:// — дождаться отрисовки
    await new Promise((r) => setTimeout(r, 800));
    const outPath = path.join(mockDir, png);
    await page.locator('.tm-viewport').screenshot({
      path: outPath,
      type: 'png',
    });
    console.log('OK', png);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
