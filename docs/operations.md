# Operations (Stage 9)

Этот документ фиксирует операционные процедуры для текущего состояния проекта.

См. также:

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

## 5) Smoke Operations Checks

При поднятом `npm run dev`:

```bash
npm run test:proposals
npm run test:proposals-submit
npm run test:proposals-stage7
npm run test:proposals-stage8
```

### Новости RSS → `NewsCache`

- `GET /api/news` **только** отдаёт записи из PostgreSQL (`NewsCache`), без загрузки RSS в hot path.
- Синхронизация источников: `src/lib/news/syncFeeds.ts`, вызов из защищённого endpoint:
  - `POST /api/cron/news-sync` или `GET /api/cron/news-sync`
  - заголовок `Authorization: Bearer <CRON_SECRET>` **или** query `?secret=<CRON_SECRET>` (query слабее, не логировать URL с секретом).
  - **Vercel Cron:** в корне репозитория [`vercel.json`](../vercel.json) — расписание **каждый час** (`0 * * * *`), запрос GET на `/api/cron/news-sync` с заголовком `x-vercel-cron: 1` (секрет для этого вызова не нужен; не подделывается снаружи Vercel). Требуется тариф с поддержкой Cron Jobs (см. документацию Vercel).
- Ручной/локальный вызов: env `CRON_SECRET` (минимум 8 символов). Без секрета и без заголовка Vercel Cron endpoint отвечает `503`.
- **503 при `npm run scripts:sync-news`:** у процесса `npm run dev` нет `CRON_SECRET`. Добавьте в **`.env.local`** в корне проекта строку `CRON_SECRET=тот-же-секрет-ascii` и **перезапустите** dev-сервер (Next подхватывает env только при старте). Скрипт sync сам читает `.env.local` для заголовка Bearer.
- Локально после `npm run dev` (bash / Linux / macOS):

```bash
CRON_SECRET="your-long-random-secret" npm run scripts:sync-news
```

**Windows PowerShell** (синтаксис `VAR=value cmd` не работает в PowerShell). Секрет — **только ASCII** (латиница, цифры, символы); кириллица в `Authorization` вызовет ошибку `ByteString` в fetch.

```powershell
$env:CRON_SECRET = "local-dev-secret-change-me-32"
npm run scripts:sync-news
```

`BASE_URL` по умолчанию `http://127.0.0.1:3000`.

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


