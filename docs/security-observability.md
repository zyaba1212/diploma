# Stage 10: Security + Observability (production depth)

> Расширенная версия threat model и политик: [`stage10-security-observability.md`](./stage10-security-observability.md) (два файла перекрёстно дополняют друг друга; при расхождении приоритет у более детального раздела в `stage10-*`).

## Scope

Документ фиксирует архитектурные решения Stage 10 без изменения публичных API-контрактов Stage 5-8.

Цели:
- уменьшить риск злоупотребления API и утечки данных;
- стандартизировать security baseline для production;
- зафиксировать наблюдаемость (что логируем, сколько храним, что считаем PII).

## Threat Model (lite)

### Assets

- данные `Proposal`, `ChangeAction`, `HistoryEntry`, `NetworkElement`;
- приватные server-side секреты (`DATABASE_URL`, `SOLANA_SUBMISSION_PAYER_PRIVATE_KEY*`);
- доступность API (`/api/proposals/*`, `/api/network`, `/api/tile`, `/api/geocode/*`).

### Attack surfaces

- **Auth/signature paths**: `POST /api/auth/verify`, `POST /api/proposals/:id/submit`.
- **Mutation paths**: `POST /api/proposals/:id/actions|apply|rollback`.
- **Proxy endpoints**: `/api/tile`, `/api/geocode/*` (потенциал SSRF/abuse).
- **Operational endpoints**: `/api/health` (recon risk + abuse).

### Top risks and controls

1. **API abuse / flood**  
   - Controls: rate limiting per-IP for hot endpoints, bounded payload size, timeouts.

2. **Signature misuse / replay-like behavior**  
   - Controls: backend recompute `contentHash`, strict message format checks, status gates, idempotent behavior when `onChainTxSignature` already exists.

3. **Proxy misuse (tile/geocode)**  
   - Controls: allowlist for `source`, request limits, upstream timeouts, strict error shape.

4. **Secret leakage**  
   - Controls: secret manager only, no secret values in logs, no server secrets in `NEXT_PUBLIC_*`, policy in `docs/secrets-policy.md`.

5. **Rollback/history corruption**  
   - Controls: `HistoryEntry.diff.kind` validation (`CREATE|UPDATE|DELETE`), rollback only against latest history entry semantics, integrity checks from DB runbook.

## Security Headers Baseline (Next.js)

Рекомендованный baseline для production (без ломки Phantom/Leaflet):

- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` (только HTTPS production).
- `X-Frame-Options: DENY` (или `SAMEORIGIN`, если есть легитимный embed use-case).
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy`: отключить неиспользуемые capability (camera/mic/geolocation и т.п.).
- `Content-Security-Policy`: вводить постепенно в `Report-Only`, затем enforce.

### CSP rollout strategy

1. Start: `Content-Security-Policy-Report-Only` + сбор violations.
2. Validate wallet + map сценарии:
   - Phantom wallet interaction;
   - tile/geocode fetch paths;
   - 3D/2D transitions and assets.
3. Enforce only after whitelist stabilized.

Минимальный CSP direction (пример, требует адаптации под реальные домены):
- `default-src 'self'`
- `script-src 'self' 'unsafe-inline'` (временно, пока не убран inline footprint)
- `connect-src 'self' https://api.devnet.solana.com ...`
- `img-src 'self' data: blob: https:`
- `style-src 'self' 'unsafe-inline'`
- `frame-ancestors 'none'`

## Observability Plan

### What to log (structured)

Сохраняем structured logs для API (формат `api_metric`):
- `route`, `method`, `status`, `durationMs`, `ok`, `timestamp`;
- optional: `requestId/correlationId` (если включено на backend).

Для ошибок:
- логировать тип ошибки и high-level reason;
- не логировать stack traces/secret values в клиентские ответы;
- не логировать payload целиком для чувствительных путей.

### PII policy

Считаем чувствительными:
- `authorPubkey` (псевдо-PII; допустимо в логах только при необходимости диагностики и в хэшированном/усеченном виде);
- любые значения из env/secrets (никогда не логировать);
- содержимое `elementPayload` может включать чувствительные метаданные — логировать только размер/shape, не full body.

### Retention and access

- Prod API logs retention target: 14-30 days.
- Security-relevant logs (auth/submit/apply/rollback failures): до 90 days при наличии централизованного хранилища.
- Access to logs: least privilege, read access only for on-call/maintainers.

## Operational invariants for Stage 10

- No changes to public API contracts Stage 5-8.
- Stage 6 message format remains `diploma-z96a propose:<contentHash>`.
- Stage 7 rollback remains aligned with backend `diff.kind` parsing contract.

## Implementation priorities (backend-first)

1. Headers baseline in middleware/next config with safe defaults.
2. Correlation-id plumbing + consistent 5xx JSON error shape.
3. Harden rate-limit and payload size guards for mutation/proxy endpoints.
4. Centralize hashing/stable stringify util (reduce frontend/backend drift).

