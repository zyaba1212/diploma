/**
 * Удаляет каталог `.next` (кэш dev/build). Использование: `node scripts/clean-next.mjs`
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const nextDir = join(root, '.next');

if (existsSync(nextDir)) {
  rmSync(nextDir, { recursive: true, force: true });
  console.log('[clean-next] removed .next');
} else {
  console.log('[clean-next] .next not found, skip');
}
