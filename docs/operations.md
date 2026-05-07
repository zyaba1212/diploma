# Operations (Stage 9)

Этот документ фиксирует операционные процедуры для текущего состояния проекта.

См. также:

- [`docs/geocode-operations.md`](./geocode-operations.md) — geocode (Nominatim proxy): таймауты, Redis-кэш, SLO, логи.
- [`docs/map-mode-benchmark.md`](./map-mode-benchmark.md) — KPI режима карты, ручной benchmark, curl-smoke; tile-proxy env (`TILE_RATE_LIMIT_*`, `TILE_DEBUG_LOG`).
- [`docs/secrets-policy.md`](./secrets-policy.md) — политика секретов.
- [`docs/release-hardening.md`](./release-hardening.md) — GO/NO-GO перед релизом и откат.
- `npm run ops:rollback-drill` — автоматизированная часть rollback drill (`scripts/rollback-drill.mjs`).

## 1) Environment Matrix

Минимально обязательные env-переменные для запуска:

- `DATABASE_URL` — PostgreSQL connection string (обязательно для app и health/db-check).
- `NEXT_PUBLIC_SOLANA_RPC` или `SOLANA_RPC_URL` — RPC для Stage 6 submit (production path).
- `SOLANA_SUBMISSION_PAYER_PRIVATE_KEY_B58` (или `SOLANA_SUBMISSION_PAYER_PRIVATE_KEY`) — payer key для production submit.
- `NODE_ENV` — `development` или `production`.

Пример `.env.local` (локальная разработка):

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/diploma?schema=public"
NEXT_PUBLIC_SOLANA_RPC="https://api.devnet.solana.com"
SOLANA_RPC_URL="https://api.devnet.solana.com"
SOLANA_SUBMISSION_PAYER_PRIVATE_KEY_B58="<base58-private-key>"
```

## 2) Startup Runbook

Локальный startup:

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Проверка готовности после старта:

```bash
curl -sS http://localhost:3000/api/health
```

Ожидаемый успешный ответ:

```json
{ "ok": true, "app": "ok", "db": "ok" }
```

Если БД недоступна, endpoint возвращает `503` и `{ "error": "health check failed" }`.

## 3) Shutdown Runbook

- Остановить процесс приложения (`Ctrl+C` в терминале с `npm run dev`/`npm run start`).
- Убедиться, что нет зависших миграций/долгих транзакций в PostgreSQL.
- При необходимости перезапуска после падения сначала проверить health endpoint.

## 4) CI Baseline

CI workflow находится в `.github/workflows/ci.yml` и запускается на `push`/`pull_request`.

Шаги CI:

```bash
npm ci
npm run lint
npm run build
```

Node policy в CI: `22`.

Локальная проверка (copy-paste перед push):

```bash
npm ci && npm run lint && npm run build
```

## 4.5) Map mode — tile proxy и производительность

Pan/zoom генерирует много параллельных запросов к [`/api/tile`](../src/app/api/tile/route.ts). Настройки:

| Переменная | Default | Назначение |
|------------|---------|------------|
| `TILE_RATE_LIMIT_MAX` | `4000` | Макс. запросов на IP за окно (in-memory / Redis при `RATE_LIMIT_BACKEND=redis`). |
| `TILE_RATE_LIMIT_WINDOW_MS` | `60000` | Окно лимита (мс). |
| `TILE_DEBUG_LOG` | (не `0`) | Структурированные строки `scope:tile` в stdout: по умолчанию **без** логирования каждого успешного тайла; `1` или `verbose` — полный лог; `0` — выключить. |

Circuit breaker upstream (мягче дефолта geocode): [`TILE_CIRCUIT_OPTS`](../src/lib/tile/tileConstants.ts). Корреляция: заголовки **`x-correlation-id`** / **`x-request-id`** на запросе к `/api/tile` (иначе генерируется UUID).

**Наблюдаемость / алерты (ручные или по логам):** всплески JSON-строк с `"outcome":"rate_limited"` или `"outcome":"circuit_open"` относительно базовой линии; доля **502** по `/api/tile` в gateway.

Ключевые KPI и ручной benchmark: [`docs/map-mode-benchmark.md`](./map-mode-benchmark.md). Клиентский perf-трейс reverse: **`NEXT_PUBLIC_MAP_PERF_DEBUG=1`**. SLA геокода (клиент ↔ Next ↔ Nominatim): константы в [`src/lib/geocode/constants.ts`](../src/lib/geocode/constants.ts) — **`GEOCODE_CLIENT_FETCH_TIMEOUT_MS`** (браузер), **`GEOCODE_UPSTREAM_TIMEOUT_MS`** (прокси → Nominatim); при ошибках reverse в ответе возможны поля **`code`** / заголовок **`x-geocode-code`**.

## 5) Smoke Operations Checks

При поднятом `npm run dev`:

```bash
npm run test:proposals
npm run test:proposals-submit
npm run test:proposals-stage7
npm run test:proposals-stage8
```

### Новости RSS → `NewsCache`

**Live (через приложение):**

- `GET /api/news` перед выборкой вызывает `fetchAndCacheNews()` ([`src/lib/news.ts`](../src/lib/news.ts)) — RSS → `NewsCache`, in-process TTL ~30 мин.
- Ответ пагинации: **`items`**, **`total`**, **`page`**, **`pageSize`**, **`hasMore`**, **`windowDays`** (окно по `publishedAt` расширяется 3→7→14→…→вся таблица, если для текущей страницы записей не хватает). Параметры: **`page`**, **`pageSize`** (макс. 100), **`days`**. Страница `/news` передаёт `days=3`.
- **`?legacy=1`** — прежний JSON-массив + **`limit`** / **`offset`**.

**Ограничение RSS:** в фиде только «хвост» последних записей; разрывы по датам в ленте — из-за фильтра ключевых слов, лимита на источник и того, что в кэш попадают не все дни. Полный архив издателя этим путём не восстановить.

**Cron (реализовано):**

- `GET` или `POST` [`/api/cron/news-sync`](../src/app/api/cron/news-sync/route.ts) — принудительный `fetchAndCacheNews({ force: true })`.
- Допуск: заголовок **`x-vercel-cron: 1`** (Vercel Cron из [`vercel.json`](../vercel.json), каждый час) **или** `Authorization: Bearer <CRON_SECRET>` **или** query `?secret=<CRON_SECRET>` (query слабее, не логировать с секретом).
- Если `CRON_SECRET` не задан или короче 8 символов — для вызовов **без** `x-vercel-cron` ответ **`503`** (`CRON_SECRET not configured`); при неверном секрете — **`401`**.

**Backfill (отдельно от runtime):**

CLI: `npm run scripts:news-backfill` — [`scripts/news-backfill.ts`](../scripts/news-backfill.ts). Для записи в БД нужен **`DATABASE_URL`**.

1. **RSS-режим (хвост фида, без архива):** `--mode=rss` (по умолчанию).
   - Пример: `npx tsx scripts/news-backfill.ts --mode=rss --dry-run --per-source=60 --days-back=90`
   - Флаги: **`--dry-run`**, **`--per-source`**, **`--days-back`**, **`--source`** (подстрока имени), **`--limit`** (суммарный лимит по источникам).

2. **Deep-режим (sitemap-цепочки, история шире RSS):** `--mode=deep`.
   - Реестр URL и паттернов: [`src/lib/news/deepSourceRegistry.ts`](../src/lib/news/deepSourceRegistry.ts); движок: [`src/lib/news/deepBackfill.ts`](../src/lib/news/deepBackfill.ts).
   - Пример bootstrap: `npx tsx scripts/news-backfill.ts --mode=deep --dry-run --days-back=365 --max-urls=300`
   - Диапазон дат: **`--from=YYYY-MM-DD`**, **`--to=YYYY-MM-DD`** (если заданы, `--days-back` не используется).
   - Лимиты: **`--max-urls`**, **`--max-sitemaps`**, **`--concurrency`**, фильтр **`--source=`**, **`--meta-title`** (дороже: HTML → `og:title`).
   - Ответ по источникам в логе: `sitemapsFetched`, `urlsDiscovered`, `urlsAfterPathFilter`, `urlsAfterDateFilter`, `urlsAfterRelevance`, `upserted`, `errors[]`.
   - Ограничения: sitemap-URL эвристические (сайты меняют структуру); часть издателей может отдавать **403/пусто** с датацентровых IP; записи **без `<lastmod>`** при фильтре по датам отбрасываются.

**Cron deep backfill (ночной):**

- `GET`/`POST` [`/api/cron/news-deep-backfill`](../src/app/api/cron/news-deep-backfill/route.ts) — тот же контракт авторизации, что у `news-sync`.
- Query по умолчанию в [`vercel.json`](../vercel.json): `daysBack=3&maxUrls=120` (можно переопределить: `daysBack`, `maxUrls`, `metaTitle=1`, `source=`, `dryRun=1`).
- Live `GET /api/news` **не** запускает deep backfill.

**Runbook (кратко):**

1. Первичная история: локально `npx tsx scripts/news-backfill.ts --mode=deep --from=... --to=... --max-urls=500` (без `--dry-run`), следить за логами `errors`.
2. Регулярно: полагаться на Vercel cron deep + hourly RSS sync; при сбое — ручной `news-sync` и точечный `--mode=deep --source=...`.
3. Troubleshooting: если `sitemap fetch failed` — проверить URL в реестре, robots/403, при необходимости добавить fallback `sitemapUrls` для источника.

## 6) Runtime Guards (текущее состояние)

- `/api/health` — app+db reachability check.
- Rate limit (in-memory, per-process) включен для ключевых endpoint'ов:
  - `proposals.actions`: `20 req / 60s / IP`
  - `proposals.apply`: `10 req / 60s / IP`
  - `proposals.rollback`: `10 req / 60s / IP`
  - `proposals.submit`: `15 req / 60s / IP`
  - `proposals.history`: `60 req / 60s / IP`
  - `moderation.decide`: `10 req / 60s / IP`
  - `tile`: `300 req / 60s / IP`
  - `geocode.search`: `60 req / 60s / IP`
  - `geocode.reverse`: `60 req / 60s / IP`
- Backend может переключать rate-limit store на Redis:
  - env: `RATE_LIMIT_BACKEND=redis` и `REDIS_URL`
  - при отсутствии модуля/ошибках подключения backend деградирует обратно в in-memory режим (без изменения поведения `429`/формата ответа).

## 7) Incident Checklist

1. Проверить `GET /api/health`.
2. Если `503`:
   - проверить доступность PostgreSQL и корректность `DATABASE_URL`;
   - проверить, не была ли применена несовместимая миграция.
3. Если массовые `429`:
   - подтвердить, что это ожидаемая нагрузка, а не abuse;
   - при необходимости временно снизить интенсивность клиентских запросов.
4. Если `502` на submit:
   - проверить `SOLANA_RPC_URL`/`NEXT_PUBLIC_SOLANA_RPC`;
   - проверить формат и валидность payer key env.
5. После стабилизации:
   - повторно прогнать `api/health`;
   - зафиксировать причину и шаги восстановления в `DEVELOPMENT_JOURNAL.md`.

## Post-launch (Stage 11)

Цель: закрепить эксплуатацию в production после прохождения Stage 0–10 без изменения публичных API-контрактов Stage 5–8.

Что проверять и документировать на практике:

## 1) Масштабирование и общий rate limit

- Текущее состояние: rate-limit реализован in-memory (best-effort, per-process), см. реализацию `src/lib/rateLimit.ts` и лимиты в `docs/operations.md`.
- При multi-instance production нужно обеспечить общий rate limit (например, Redis/distributed store), при этом формат ответов для `429` должен остаться прежним: `{ error: "rate limit exceeded" }` + status `429`.
- При включении moderation endpoints убедиться, что единые ограничения применяются и к `POST /api/moderation/*` (т.е. поведение `429`/headers совпадает независимо от количества инстансов).

## 2) Наблюдаемость (observability) и retention

- Primary probe и готовность: `GET /api/health` (app+db).
- Structured API logs: линии `api_metric` с полями `route`, `method`, `status`, `durationMs`, `ok`, `note?`.
- Для `/api/moderation/*` должны появляться те же `api_metric` линии (route/method/status/durationMs/ok) + корреляция (если включена), чтобы алерты по 4xx/5xx и latency работали единообразно.
- Если Redis-коннект/модуль недоступны и backend деградирует в in-memory режим, это должно быть явно видно по логам/метрикам (иначе общий rate limit нельзя корректно считать работающим в проме).
- Для connection pooling: мониторить признаки насыщения/ошибок pool (рост активных соединений, ошибки коннекта, таймауты) и привязать алерты к росту latency/5xx на DB-зависимых маршрутах.
- Для алертов использовать SLO-lite targets из раздела ниже (`SLO-lite (Stage 9)`), а инцидент фиксировать в `DEVELOPMENT_JOURNAL.md`.

## 3) Операционный readiness: rollback-drill

- Перед cutover выполнять чеклист отката:
  - `npm run ops:rollback-drill`
- После каждого подозрительного изменения параметров окружения прогонять минимум:
  - `curl -sS http://localhost:3000/api/health`
  - smoke по proposals (если используется в релиз-процессе).

# Operations: Deployment + Observability + Runbooks

## Target Deployment Topology

### Baseline (recommended for current project maturity)

- **App runtime**: single Next.js instance (Node runtime) behind reverse proxy/load balancer.
- **Database**: one PostgreSQL primary instance (managed preferred), private network access.
- **File/object storage**: not required for core flow now (all core state in Postgres).
- **Secrets**: environment variables injected at deploy time via secret manager (never in repo).
- **Backups**: daily logical backup + WAL/point-in-time policy at DB layer (if managed DB supports PITR).

### Scale-up target (when traffic grows)

- **App runtime**: multi-instance stateless Next.js services.
- **DB**: PostgreSQL primary + optional read replica for read-heavy endpoints.
- **Rate limit/storage shared state**: move from in-memory to Redis/distributed store.
- **Logs/metrics**: centralized aggregation (Loki/ELK/Datadog/etc.) with retention policy.

## Operational Invariants

- Existing API contracts for `/api/network`, `/api/auth/*`, `/api/tile`, `/api/geocode/*`, and Stage 5-8 `/api/proposals/*` must remain backward compatible unless explicitly versioned.
  - **`GET /api/network`**: ответ по-прежнему содержит **`providers`** и **`elements`**. Для запросов с параметром **`bbox`** дополнительно может присутствовать опциональный блок **`meta`** (`worldish`, `reason`, эхо **`bbox`**) — только диагностика; клиенты и скрипты, парсящие только `providers`/`elements`, остаются совместимыми. Ветка без `bbox` (`take`-листинг) **`meta` не возвращает**.
- Stage 6 signature message format remains: `diploma-z96a propose:<contentHash>`.
- Stage 7 rollback depends on `HistoryEntry.diff.kind` semantics (`CREATE|UPDATE|DELETE`) and must stay aligned with backend parser.
- Deployment must not expose private keys (`SOLANA_SUBMISSION_PAYER_PRIVATE_KEY*`) in logs or client bundles.

## SLO-lite (Stage 9)

Minimal operational targets (non-contractual, for team alignment):

- **API availability**: >= 99.5% monthly for core app endpoints.
- **Time to recover (MTTR target)**: <= 60 minutes for P1 incidents.
- **Max acceptable data loss (RPO-lite)**: <= 24 hours with daily logical backups; <= 15 minutes when PITR is enabled.
- **P95 latency targets**:
  - read endpoints (`GET /api/proposals`, `GET /api/proposals/:id`, `GET /api/network`): <= 600ms under normal load
  - mutating endpoints (`submit/apply/rollback`): <= 1500ms excluding external RPC tail latency

## Startup / Shutdown Runbook

### Startup (stage/prod)

1. Verify required env vars are present (see env matrix below).
2. Verify DB reachability (manual check or `GET /api/health` after app boot).
3. Apply DB migrations (policy-defined: pre-deploy or deploy step).
4. Start app process.
5. Run smoke checks:
   - `GET /api/health`
   - `GET /api/proposals?authorPubkey=<known>`
   - one controlled write in stage (`POST /api/proposals`)
6. Mark deploy healthy only after health + smoke pass.

### Graceful shutdown

1. Stop receiving new traffic (drain from LB/reverse proxy).
2. Wait for in-flight requests to complete.
3. Stop app process.
4. Ensure no migration/backfill jobs remain running.

## Health Checks

Use `GET /api/health` as primary probe:

- Healthy response target: `200` with `{ ok: true, app: "ok", db: "ok" }` (or equivalent).
- Unhealthy response target: `503` with stable JSON error shape (no stack traces).

Recommended checks:

- **Liveness**: process is up (fast check).
- **Readiness**: app + DB reachable.

## Incident Flow (P1/P2)

### Trigger examples

- sustained 5xx spike
- DB connectivity failures
- submit/apply/rollback failure rate spike
- severe latency regression

### Flow

1. **Detect**: alert/log spike observed.
2. **Triage**: classify severity (P1/P2/P3), identify blast radius.
3. **Mitigate first**:
   - rollback last deploy if regression-induced
   - disable risky feature path behind flag/config where possible
   - protect DB with temporary rate limits if needed
4. **Recover**:
   - restore stable service
   - validate with health + smoke checks
5. **Post-incident**:
   - document timeline/root cause/actions
   - create follow-up tasks (tests/guards/docs updates)

## Env Vars Matrix (prod/stage)

### Required (app + DB)

- `DATABASE_URL`
- `NODE_ENV` (`production` for prod)

### Required for Stage 6 submit path in production

- `SOLANA_RPC_URL` (or `NEXT_PUBLIC_SOLANA_RPC` per current backend fallback)
- `SOLANA_SUBMISSION_PAYER_PRIVATE_KEY_B58` (or `SOLANA_SUBMISSION_PAYER_PRIVATE_KEY`)

### Optional / recommended

- `LOG_LEVEL` (if supported by logger setup)
- deployment-specific tracing/metrics envs (vendor-specific)

## Backup / Restore Baseline

- Daily logical dump (`pg_dump`) retained at least 7 days.
- Regular restore drill in stage (at least monthly).
- If managed Postgres supports PITR, keep PITR enabled for lower RPO.

## Deployment Checklist (copy-paste)

1. Config present (`DATABASE_URL`, Solana keys if submit enabled).
2. Migrations applied.
3. App boots successfully.
4. `GET /api/health` healthy.
5. Stage 5-8 smoke endpoints respond with expected JSON shapes.
6. Logs show no startup errors.
7. Rollback plan confirmed before traffic cutover.

## Stage 11 (post-launch): production scaling + maturity

Этот раздел описывает target-профиль нагрузки и операционные инварианты после релиза (без изменений публичных API Stage 5–8).

Дополнение: исполнительное резюме и архитектурные решения собраны в `docs/stage11-post-launch-architecture.md`.

### 1) Target load profile (RPS / instances / regions)

Предположения (для планирования):

- UI-heavy workload с 2 типами горячих потоков:
  - чтение/рендер: `GET /api/proposals`, `GET /api/proposals/:id`, `GET /api/network`
  - прокси и тайлы: `GET /api/tile`, `GET /api/geocode/*` (самый частый источник RPS)
- Mutation paths (submit/apply/rollback) существенно реже и требуют стабильности, но не доминируют по RPS.

Рекомендованный профиль для старта продакшена (single region, single AZ):

- **instances**: `2` статeless инстанса Next.js (минимум для отказоустойчивости)
- **DB**: один primary Postgres с подключением через pool (client-side pooling / PgBouncer при необходимости)
- **multi-region**: off по умолчанию; включать только при наличии latency/availability требований
- **target RPS (примерные ориентиры)**:
  - `GET /api/proposals` (list): `5–15 RPS`
  - `GET /api/proposals/:id`: `1–5 RPS`
  - `GET /api/network`: `2–10 RPS` (в основном во время загрузки/карт)
  - `GET /api/tile`: `50–200 RPS` суммарно (агрегировано по всем пользователям, с учетом rate-limit)
  - `GET /api/geocode/*`: `5–30 RPS` суммарно
  - `submit/apply/rollback`: `0.1–2 RPS` суммарно (пик ограничен UX и wallet actions)

Критерий масштабирования:

- увеличивать количество инстансов по CPU/latency (горизонтально),
- при росте суммарного RPS tile/geocode — масштабировать rate-limit storage и upstream concurrency.

### 2) Shared state requirements (Redis)

При multi-instance следующая shared state становится обязательной для предсказуемости:

- **Distributed rate limiting**:
  - заменить in-memory per-process rate limiter на Redis-backed (или аналог),
  - обеспечить одинаковые ограничения на запросы при любом количестве инстансов.
- **Как включается Redis-backed rate limit (целевое поведение v1)**:
  - Redis используется только если задано `RATE_LIMIT_BACKEND=redis` и присутствует `REDIS_URL`.
  - Если Redis недоступен (ошибка подключения/модуля) — backend деградирует обратно в in-memory режим, при этом форма ответа для клиента (`429` + `{ error: "rate limit exceeded" }`) сохраняется.
  - При горизонтальном масштабировании деградация на in-memory приводит к “не идеально одинаковым 429” на разных инстансах — это операционный риск, который должен быть заметен через алерты/логи.
- **Sessions**: в текущей архитектуре server-side сессии не используются, поэтому отдельный session-store не требуется.

Обязательные свойства Redis (для rate-limit):

- поддержка TTL / atomic increments (через Lua или built-in atomic ops),
- отказоустойчивость (кластер/replica при возможности),
- не логировать и не хранить в Redis секреты (только счетчики/ключи rate-limit).

### 3) Observability: what is an incident

Единый подход: инцидентом считаем событие, при котором ухудшается SLO-lite или возникает риск некорректных данных.

Источник сигналов для алертов:

- structured logs `api_metric` на ключевых endpoints (`/api/health`, `submit/apply/rollback`) с полями `route/method/status/durationMs/ok` (как зафиксировано в Stage 10),
- единая correlation-id (если включено) для трассировки инцидентов,
- соблюдение PII policy из Stage 10 (не логируем секреты, не логируем full payload чувствительных путей; авторские pubkey — только в допустимом псевдо/усеченном виде).

Рекомендуемые алерт-условия (пример):

- **P1 (production degraded)**:
  - health-check `GET /api/health` стабильно `!= 200` более `5 минут`
  - суммарный 5xx rate по ключевым routes (`/api/proposals*`, `/api/moderation/*`, `/api/health`, `submit/apply/rollback`) > `2%` за последние 5 минут
  - p95 latency по mutation routes (`submit/apply/rollback`) > `3s` за 10 минут (без external RPC tail объяснения)
- **P2**:
  - p95 latency по read routes > `1.5s` за 10 минут
  - частые `502/503` на внешних прокси (`tile/geocode`) без признаков нормализации после rate-limit
- **P3 / warning**:
  - всплески `429` выше ожиданий (например, рост > `5x` относительно baseline) — скорее operational сигнал, чем “crash”

Что считать recovery:

- health-check вернулся в `200`,
- 5xx rate снизился ниже порога в течение `N минут`,
- latency возвращается в acceptable range по p95.

### 4) Retention and access for operational data

- logs: retention 14–30 дней для прод API; security-relevant до 90 дней при наличии централизованного хранилища;
- metrics: хранение минимум `7–30 дней` для трендов, при наличии недорогого backend — дольше;
- access: least privilege на просмотр логов/metrics.

### 5) Stage 12: что мониторить после включения Redis/pool (узкий слой)

- **Redis-backed rate limit**:
  - алерт “Redis backend disabled/fallback observed” (через логи/метрики на стороне бэкенда): если в окружении ожидается shared state, а запросы продолжают ограничиваться in-memory, вероятность “неодинаковых 429” резко растет.
- **Connection pooling**:
  - алерт “DB connection pressure / pool saturation” (число активных соединений, очереди, рост p95 latency на proposals endpoints).
  - health-check остаётся первичным сигналом (`GET /api/health`), но отдельный мониторинг p95 чтений/мутаций нужен, чтобы поймать деградацию пула до полного падения.


