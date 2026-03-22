# Stage 10: Security + Observability (production depth)

> Краткий baseline (lite): [`security-observability.md`](./security-observability.md).

## Scope

Этот документ фиксирует архитектурный baseline Stage 10:
- threat model для ключевых путей,
- рекомендации по security headers для Next.js,
- observability policy: что логировать, retention, PII boundaries.

Инвариант: публичные API-контракты Stage 5-8 не меняются.

## 1) Threat model (кратко)

### 1.1 Auth / wallet signature

Активы:
- `User.pubkey`, подписи `signMessage`, submission facts (`contentHash`, `signature`, `onChainTxSignature`).

Угрозы:
- replay подписанных сообщений,
- подмена `authorPubkey`,
- brute-force/abuse submit endpoint.

Текущие меры:
- backend в Stage 6 проверяет подпись `tweetnacl + bs58` для `diploma-z96a propose:<contentHash>`,
- idempotency при наличии `onChainTxSignature` (повторный submit не переотправляет tx),
- rate limits на submit/action/apply/rollback.

Усиление Stage 10 (без ломки контрактов):
- mandatory correlation id в 5xx-логах server-side,
- отдельный alert на spike `401/429` для submit path,
- фиксировать replay-pattern (одинаковая подпись в коротком окне) в structured logs.

### 1.2 API abuse (mutation paths)

Активы:
- целостность `Proposal`, `ChangeAction`, `HistoryEntry`, `NetworkElement`.

Угрозы:
- flood на mutation endpoints (`actions/apply/rollback/submit`),
- oversized payload (`elementPayload`) для деградации Node process,
- неконсистентный `HistoryEntry.diff` для rollback corruption.

Текущие меры:
- per-IP in-memory rate limits (best effort),
- базовая валидация payload в route handlers.

Усиление Stage 10:
- hard limits на размер request body для mutating routes,
- строгая валидация `diff.kind` и snapshot shape перед rollback apply,
- вынос rate-limit state в shared store (Redis) при multi-instance deployment.

### 1.3 Geocode/tile proxy

Активы:
- доступность API, бюджет внешних запросов, отсутствие SSRF/open-proxy.

Угрозы:
- массовые прокси-запросы и quota exhaustion,
- попытки обхода source allowlist.

Текущие меры:
- allowlist/валидация source и rate limits.

Усиление Stage 10:
- добавить timeout budget + circuit-breaker policy на upstream errors,
- алерты на sustained 429/5xx по proxy routes.

### 1.4 Proposals mutation + history rollback

Активы:
- корректность apply/rollback sequence.

Угрозы:
- drift между форматом `HistoryEntry.diff` в docs и коде,
- некорректный rollback при partially malformed snapshots.

Текущие меры:
- rollback парсит `diff.kind` (`CREATE|UPDATE|DELETE`) и ожидает конкретные поля.

Усиление Stage 10:
- schema-level/check constraints для `diff.kind` (DB layer),
- smoke rollback drill как обязательная pre-release операция.

## 2) Security headers recommendations (Next.js)

Цель — усилить baseline без поломки Phantom/Leaflet.

Рекомендуемый minimum:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` (или `SAMEORIGIN`, если потребуется embed)
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(self), camera=(), microphone=()`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` (только production HTTPS)

### CSP (поэтапно)

Включать поэтапно, чтобы не сломать wallet/maps:
1. Stage 10 baseline: report-only CSP.
2. Зафиксировать allowlist для:
   - Solana RPC endpoints,
   - tile/geocode upstream origins,
   - wallet-injected scripts (минимально необходимый набор).
3. После стабилизации перевести в enforce mode.

Нельзя:
- вводить CSP, ломающую `Phantom` connect/sign flow,
- блокировать ресурсы Leaflet tiles, которые уже поддерживаются proxy-контрактом.

## 3) Observability plan (logging/retention/PII)

### 3.1 Что логировать (structured logs)

Обязательные поля для server events:
- `ts`, `level`, `service`, `env`,
- `route`, `method`, `status`, `durationMs`,
- `requestId` (correlation id),
- `clientIpHash` (хеш IP, не raw),
- `note`/`errorCode` (без stack trace наружу в response).

Для mutation endpoints (`submit/actions/apply/rollback`):
- outcome (`ok|error`),
- proposal id (если доступен),
- rate-limit hit flag.

### 3.2 Retention policy (SLO-lite aligned)

- app logs:
  - hot retention: 14 days,
  - cold retention: 90 days (compressed archive).
- security-relevant audit events (auth failures, repeated submit replays, rollback failures):
  - retention: 180 days.

### 3.3 PII / secrets policy

Не логировать:
- `DATABASE_URL`,
- `SOLANA_SUBMISSION_PAYER_PRIVATE_KEY*`,
- raw signatures/secret material,
- raw client IP (хранить hash/truncated form).

Разрешено логировать:
- `pubkey` (как публичный идентификатор),
- `proposalId`, `historyId`, `txSignature` (усечённо в user-facing логах).

### 3.4 Alerting baseline

Минимальные алерты:
- `5xx rate` выше порога N минут,
- `429 spike` на mutation/proxy routes,
- `api/health` returns non-200,
- rollback/apply failure ratio выше порога.

## 4) Production readiness checklist (Stage 10 architecture view)

- Security headers включены и проверены в stage.
- CSP запущен в report-only и собраны отчёты минимум 7 дней.
- Structured logs с correlation id доступны централизованно.
- Retention и PII policy применены к runtime логам.
- Rollback drill (`npm run ops:rollback-drill`) выполняется перед major release.

