# diploma-z96a

WEB3 Next.js приложение для визуализации (и позже редактирования) инфокоммуникационной сети на 3D-глобусе (Three.js) с переходом в 2D-карту (Leaflet). Авторизация через Phantom (Solana) по подписи сообщения. Данные — PostgreSQL через Prisma.

## Быстрый старт

1) Установить зависимости:

```bash
npm i
```

2) Создать `.env.local` на базе `.env.example` и настроить `DATABASE_URL`.

**PostgreSQL в Docker (Windows):** пошагово — `docs/local-dev-docker.md` (роли агентов, Prisma, проверка).

**Windows dev-сборка:** Watchpack / `Cannot find module './NNN.js'` — см. **`docs/windows-dev.md`** (команда `npm run dev:clean`).

3) Prisma:

```bash
npm run prisma:generate
npm run prisma:migrate
```

4) Запуск:

```bash
npm run dev
```

5) Smoke‑тесты API `/api/proposals` (Stage 5 минимум)

```bash
# в другом терминале должен быть запущен `npm run dev`
npm run test:proposals
```

## Текущий статус

- Stages 0–12: baseline реализован (ops, security, post-launch notes, Redis-ready rate limit, moderation API, CI, health).
- Stage 12 (implementation + moderation): `docs/stage12-scope.md` · модерация `POST /api/moderation/proposals/:id/decide`, `/moderate`, `MODERATOR_PUBKEYS`.
- Stage 11 (post-launch): `docs/stage11-post-launch-architecture.md`, `docs/operations.md`.
- Основные блоки: auth + 3D/2D visualization + proposals + submit + apply/history/rollback.
- **Личный кабинет:** `/cabinet` — username (уникальный); после `git pull` применить миграции: `npx prisma migrate deploy`.
- **UX / Globe:** Home (`/`) — описание; About (`/about`) — автор; интерактивная сеть EarthScene — **`/global-network`** (кнопка `Глобальная сеть` в шапке видна только на `/` и `/about`); left-nav удалён; `/cables` — legacy alias той же страницы. Элемент сети по API: `GET /api/network/elements/:id`.

## Документация

- `docs/requirements.md` — требования
- `docs/architecture.md` — архитектура и потоки
- `docs/earth-visualization.md` — 3D глобус: текстуры Земли, офлайн-режим
- `docs/network-data-and-sources.md` — откуда данные сети, упрощение модели, импорт кабелей (`npm run scripts:sync-cables`)
- `docs/windows-dev.md` — Watchpack, очистка `.next` (`npm run dev:clean`), Turbopack (`npm run dev:turbo`)
- `docs/etapy.md` — дорожная карта / прогресс по стадиям (Stage 5 отмечен как реализованный минимум)
- `docs/operations.md` — operations runbooks, env matrix, incident checklist (Stage 9)
- `docs/secrets-policy.md` — политика секретов (release hardening)
- `docs/release-hardening.md` — GO/NO-GO и откат перед релизом
- `PROJECT_STAGES.md` — инварианты/этапы
- `docs/stage12-scope.md` — scope Stage 12 (реализация Stage 11 + moderation)
- `docs/agents/stage12-prompts.md` — задачи по агентам (A–G) для Stage 12
- `DEVELOPMENT_JOURNAL.md` — журнал решений/граблей
- `AGENTS.md` — роли и промпты агентов
- `docs/COORDINATOR_DEV_PLAN.md` — текущий план приоритетов (координатор)
- `docs/ARCHITECT_CHAT_PLAN.md` — канонический план из чата ArchitectAgent (этапы, агенты, скрипт Stage 5)
- `docs/agents/auth-profile-phase-prompts.md` — username, личный кабинет, подпись (фаза Auth / Profile)
- `docs/agents/wallet-autoconnect-prompt.md` — политика autoconnect / бездействие кошелька (исполнитель: Web3SolanaAgent)

## CI и smoke

- GitHub Actions baseline workflow: `.github/workflows/ci.yml` (`npm ci`, `npm run lint`, `npm run build`, информационный `npm audit` с `continue-on-error`, Node 22).
- Manual smoke workflow: `.github/workflows/smoke-tests.yml` (запуск через `workflow_dispatch`, поднимает Postgres service и прогоняет Stage 5/6/7/8 smoke tests).
- Локально перед push:

```bash
npm ci
npm run lint
npm run build
```

- Smoke tests запускать при поднятом `npm run dev` (в отдельном терминале):

```bash
npm run test:proposals
npm run test:proposals-submit
npm run test:proposals-stage7
npm run test:proposals-stage8
```

Опционально (доп. smoke):
```bash
npm run test:auth-profile-smoke
npm run test:ux-globe-smoke
# geocode внешних источников при отсутствии интернета можно пропустить:
# SKIP_GEOCODE_SMOKE=1 npm run test:ux-globe-smoke
```

- Rollback drill (проверка health + чеклист отката):

```bash
npm run ops:rollback-drill
```

## Post-launch (Stage 11)

Для эксплуатационной зрелости после Stage 0–10 используйте:
- `docs/operations.md` — раздел `Post-launch (Stage 11)` (масштабирование, общий rate limit, observability, rollback-drill).
- `docs/agents/stage11-prompts.md` — общий план задач по агентам (координатор выдаёт в чате).

## UX / Globe phase (минимальные заметки)

- Зум: колесо мыши/тачпад управляет камерой, значение ограничено clamp’ом; текущий zoom показывается в UI.
- 3D/2D: переключение только вручную (кнопки `3D` и `2D`), без zoom-based авто-переходов; переход `3D -> 2D` вычисляет `Leaflet center` из текущего `globeGroup` (mid-point глобуса), переход `2D -> 3D` ориентирует `globeGroup` так, чтобы текущий Leaflet center соответствовал центру 3D-камеры.
- Site skeleton v2: в шапке только centered `Главная` (без left-nav) и кнопка `Глобальная сеть`, которая показывается только на `/` и `/about`.
- Локальные подписи на 3D (в текущем минимальном UI) пока не добавлены.
- Глобальная сеть (EarthScene): доступна на странице `/global-network` (кнопка в шапке); legacy alias `/cables` оставлен для совместимости.
- Геокодинг: backend proxy доступен по `GET /api/geocode/search?q=...` и `GET /api/geocode/reverse?lat=&lng=...` (UI может ещё не использовать их полностью).

