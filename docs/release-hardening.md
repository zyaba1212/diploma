# Release hardening (GO / NO-GO)

Используйте этот чеклист перед выкатом в **stage** или **production**.

## Pre-deploy (обязательно)

- [ ] Ветка/тег зафиксированы; известен **commit SHA** релиза.
- [ ] `npm ci && npm run lint && npm run build` проходят локально или в CI.
- [ ] Stage 10 docs sync завершён: `docs/architecture.md`, `docs/requirements.md`, `docs/secrets-policy.md`, `docs/release-hardening.md` не противоречат текущему коду.
- [ ] Миграции Prisma просмотрены: `prisma/migrations/*` соответствуют ожидаемым изменениям схемы.
- [ ] Секреты: см. [`docs/secrets-policy.md`](./secrets-policy.md) — нет утечек в коде/логах.
- [ ] `DATABASE_URL` и Solana env заданы в секретах окружения (не в репозитории).

## Deploy window

- [ ] Есть окно на откат (см. [Rollback drill](#rollback)).
- [ ] Заинтересованные стороны уведомлены (если применимо).

## Post-deploy (сразу после выката)

- [ ] `GET /api/health` → `200`, тело `{ "ok": true, "app": "ok", "db": "ok" }`.
- [ ] Smoke (при необходимости): `npm run test:proposals` и связанные скрипты против **целевого** `BASE_URL`.
- [ ] Нет аномального роста 5xx в логах за первые N минут.
- [ ] Rate-limit/429 поведение на публичных proxy endpoints документировано и ожидаемо для production нагрузки.

## GO / NO-GO

| Условие | GO | NO-GO |
|--------|-----|--------|
| CI зелёный | ✅ | ❌ |
| Миграции не применены / сомнения | — | ❌ |
| Health не 200 | — | ❌ |
| Секреты не готовы | — | ❌ |

## Rollback

Краткая процедура:

1. **Приложение**: откатить деплой на предыдущий **image/tag/commit** (зависит от платформы: Docker, Vercel, k8s и т.д.).
2. **БД**: если миграция уже применена и ломает совместимость — восстановление из бэкапа по [`docs/operations.md`](./operations.md) (раздел Backup) или отдельный runbook DBA.
3. Повторить **Post-deploy** проверки на откатанной версии.

Подробный сценарий проверки готовности к откату: `npm run ops:rollback-drill` (см. `scripts/rollback-drill.mjs`).
