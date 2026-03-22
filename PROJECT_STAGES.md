# PROJECT_STAGES

Этот файл фиксирует прогресс по этапам и инварианты, которые нельзя ломать без отдельной явной задачи.

## Этапы

- Stage 0: scaffolding (Next.js/TS/ESLint/Prisma) — **done**
- Stage 1: Phantom auth — **done**
- Stage 2: 3D globe view — **done**
- Stage 3: borders/labels — **done (baseline)**
- Stage 4: network visualization + DB model + sync scripts — **done (baseline)**
- Stage 5: Propose edit mode (без блокчейна) — **done (v1)**  
  - **Сущности в БД**: `Proposal`, `ChangeAction` (структура — см. `docs/stage5plus.md` и `prisma/schema.prisma`).  
  - **Статусы Proposal, используемые на этом этапе**:  
    - `DRAFT` — черновик предложения, редактируется только автором.  
    - `SUBMITTED` — предложение отправлено на рассмотрение (дальше только модерация/авто‑решение).  
    - `ACCEPTED` — предложение одобрено и может быть применено.  
    - `REJECTED` — предложение отклонено, изменения не применяются.  
  - Дополнительные статусы (`APPLIED`, `CANCELLED`) остаются зарезервированными под последующие стадии и **пока не используются в коде**.
  - **Эндпоинты `/api/proposals/*` (реализованный минимум Stage 5):**
    - `POST /api/proposals` — создать `Proposal` в статусе `DRAFT` по `scope`, `authorPubkey`, опциональным `title`/`description`.  
    - `GET /api/proposals` — список предложений с базовой фильтрацией по `status` и `authorPubkey`.  
    - `GET /api/proposals/:id` — детали одного предложения.
- Stage 6: chain + Anchor + tx flow — **done (dev/mock on-chain path + contracts)**
- Stage 7: history + rollback — **done (v1)**
- Stage 8: polish — **done**
- Stage 9: deployment + observability + operations hardening — **done**
  - Runbooks: `docs/operations.md`, `docs/secrets-policy.md`, `docs/release-hardening.md`.
  - CI: `.github/workflows/ci.yml`; optional smoke: `.github/workflows/smoke-tests.yml`.
  - Rollback drill: `npm run ops:rollback-drill` (скрипт `scripts/rollback-drill.mjs`).
- Stage 10: security + observability (production depth) — **done**
  - Threat model + политики: `docs/stage10-security-observability.md`, `docs/security-observability.md`.
  - Код: security headers в `next.config.mjs`, `src/lib/apiError.ts` (correlation id на 5xx), UX на `/propose`.
  - CI: baseline + опциональный `npm audit` (см. `.github/workflows/ci.yml`).
- Stage 11: post-launch (эксплуатация, масштабирование, зрелость продакшена) — **done**
  - Архитектура масштабирования / multi-instance / Redis-ready rate limit: `docs/stage11-post-launch-architecture.md`.
  - Операции и SLO остаются в `docs/operations.md`; промпты этапа: `docs/agents/stage11-prompts.md`.
- Stage 12: **реализация** инфраструктурных решений Stage 11 + **governance/moderation baseline** — **done**
  - Scope: `docs/stage12-scope.md`; промпты: `docs/agents/stage12-prompts.md`.
  - Shared rate limit: Redis-ready (`src/lib/rateLimit.ts`, `RATE_LIMIT_BACKEND=redis` + `REDIS_URL`); без Redis — in-memory.
  - Модерация: `POST /api/moderation/proposals/:id/decide`, allowlist `MODERATOR_PUBKEYS`; таблица аудита `ModerationDecision` (миграция `20260320_stage12_moderation_audit_baseline`).
  - UI: `/moderate` (минимальный список SUBMITTED).
  - После `git pull` / смены схемы: `npm i` (выполняет `prisma generate` через `postinstall`) или явно `npx prisma generate` перед `npm run build`.

## Инварианты (must not break)

- **Routes/pages**: структура App Router (`src/app/*`) и имена страниц (`/propose`, `/predlozhit`) не менять без отдельной задачи.
- **API contracts**:
  - `GET /api/network?scope=GLOBAL|LOCAL&bbox=minLat,minLng,maxLat,maxLng`
  - `POST /api/auth/verify` (используется фронтом)
  - `POST /api/auth` (альтернативный endpoint)
  - `GET /api/tile?z=&x=&y=&source=osm|...`
  - `GET /api/geocode/search?q=...`
  - `GET /api/geocode/reverse?lat=&lng=...`
- **Phantom auth flow**: пользователь подписывает сообщение, сервер проверяет подпись `tweetnacl` + `bs58`, user upsert по pubkey.
- **Profile / username**: `GET /api/profile?pubkey=`, `POST /api/profile/username` (подпись сообщения как в auth); страница `/cabinet`. Схема: `User.username`, `usernameSetAt`.
- **Wallet autoconnect (клиент)**: предпочтение autoconnect (`localStorage`, см. `@solana/wallet-adapter-react`) сбрасывается после **30 мин** бездействия на сайте / между визитами по той же политике и при отключении кошелька; детали и файлы — `docs/agents/wallet-autoconnect-prompt.md`.
- **3D<->2D transition**: логика порога/гистерезиса и безопасный lifecycle Leaflet должны сохраняться.

