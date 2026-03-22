/**
 * Rollback drill — проверяет готовность к откату и напоминает ручные шаги.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 node scripts/rollback-drill.mjs
 *
 * Не содержит секретов; health проверяется публичным GET.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function main() {
  console.log('=== Rollback drill (diploma-z96a) ===\n');
  console.log(`Target BASE_URL: ${BASE_URL}\n`);

  // 1) Health — симулирует "после деплоя / после отката должны быть зелёные пробы"
  const healthUrl = `${BASE_URL.replace(/\/$/, '')}/api/health`;
  console.log(`[1] GET ${healthUrl}`);
  try {
    const res = await fetch(healthUrl, { headers: { accept: 'application/json' } });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!res.ok) {
      console.error(`    FAIL: status ${res.status}`, body);
      process.exit(1);
    }
    console.log(`    OK: status ${res.status}`, typeof body === 'object' ? JSON.stringify(body) : body);
  } catch (err) {
    console.error('    FAIL: request error', err instanceof Error ? err.message : err);
    console.error('    Hint: start app (npm run dev) and set BASE_URL if not localhost:3000');
    process.exit(1);
  }

  console.log('\n[2] Manual rollback checklist (operator):');
  console.log('    - Identify previous release: git tag / container image digest / platform revision.');
  console.log('    - Redeploy previous artifact; drain traffic if using a load balancer.');
  console.log('    - If DB migration was destructive: restore from backup (see docs/operations.md).');
  console.log('    - Re-run: GET /api/health and smoke tests with correct BASE_URL.');
  console.log('\n[3] Documentation: docs/release-hardening.md, docs/secrets-policy.md\n');
  console.log('Rollback drill completed successfully (automated checks passed).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
