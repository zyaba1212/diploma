/**
 * Вызывает серверную синхронизацию RSS → NewsCache (POST /api/cron/news-sync).
 * Подхватывает CRON_SECRET из .env / .env.local (как Next.js), если не задан в окружении.
 *
 * Важно: у запущенного `npm run dev` тот же CRON_SECRET должен быть в .env.local — иначе 503.
 * После добавления строки в .env.local перезапустите dev-сервер.
 *
 *   BASE_URL=http://localhost:3000 node scripts/sync-news.mjs
 */

import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFromFile(fileName, overrideExisting) {
  const full = path.join(projectRoot, fileName);
  if (!existsSync(full)) return;
  const text = readFileSync(full, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (overrideExisting || process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFromFile('.env', false);
loadEnvFromFile('.env.local', true);

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const secret = process.env.CRON_SECRET;

async function main() {
  if (!secret || String(secret).length < 8) {
    console.error(
      'Set CRON_SECRET (min 8 chars): in PowerShell $env:CRON_SECRET=... or add CRON_SECRET=... to .env.local in the project root.',
    );
    process.exit(1);
  }
  if (!/^[\x20-\x7E]+$/.test(String(secret))) {
    console.error(
      'CRON_SECRET must contain only ASCII printable characters (English letters, digits, symbols).',
    );
    process.exit(1);
  }
  const url = `${BASE.replace(/\/$/, '')}/api/cron/news-sync`;
  console.log('POST', url);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      accept: 'application/json',
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  console.log(res.status, body);
  if (res.status === 503 && body && typeof body === 'object' && body.error === 'cron not configured') {
    console.error(
      '\nThe Next.js server does not see CRON_SECRET. Add the same line to .env.local in the project root:\n' +
        '  CRON_SECRET=your-ascii-secret-min-8-chars\n' +
        'Then restart: stop `npm run dev` and start it again, then run this script.',
    );
  }
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
