# Stage 11: Post-launch Architecture (scaling + observability)

## Invariants

- Не менять публичные API-контракты Stage 5–8.
- Поддерживать согласованность Stage 6/7 semantics:
  - `diploma-z96a propose:<contentHash>` для Stage 6 signature,
  - `HistoryEntry.diff.kind` (`CREATE|UPDATE|DELETE`) для Stage 7 rollback.

## 1) Target load profile (initial production)

### 1.1 Baseline assumptions (MVP production)

- Single-region deployment (one primary region).
- App runtime: start with **2 instances** behind a load balancer; allow autoscaling up to **4 instances**.
- DB: one managed PostgreSQL primary (no read replica initially; reads are handled by SQL indexes + caching at app layer if needed later).
- No multi-region failover in v1; DR is handled via DB backups + rollback drill.

### 1.2 RPS expectations (team-level target, for SLO alignment)

_Non-contractual estimates; use them to size the infra and alert thresholds._

- Read endpoints (`GET /api/proposals`, `GET /api/proposals/:id`, `GET /api/network`, `GET /api/proposals/:id/history`):
  - avg target: `20–60 RPS`
  - p95 latency SLO target is defined in `docs/operations.md` (<= `600ms`).
- Mutation endpoints (`POST /api/proposals/:id/submit`, `actions`, `apply`, `rollback`):
  - avg target: `1–5 RPS` total across users
  - p95 latency SLO target in `docs/operations.md` (<= `1500ms` excluding external RPC tail latency).
- Proxy routes (`/api/tile`, `/api/geocode/*`):
  - expect bursty patterns; rely on rate limits and timeouts.

## 2) Shared state requirements (multi-instance)

### 2.1 Rate limiting state

Current implementation uses **in-memory, per-process** rate limiting (see `docs/operations.md`).

When moving from **2+ instances** to production:
- shared state is required for rate limiting correctness (consistent 429 behavior across instances),
- recommended approach: **Redis** (or equivalent) with sliding window / token bucket.

Proposed rule:
- if instances >= 2 in production for more than a short burst: switch rate-limit storage to Redis.

### 2.2 Sessions

The system currently does not use server-side sessions (Phantom signature flow is stateless).

Therefore:
- Redis session storage is **not required** in v1.
- If later the auth flow introduces server sessions/cookies, reuse the same Redis cluster for session persistence.

## 3) Observability plan (SLO-aligned alerts + incident definition)

### 3.1 Metrics/logs sources

Use existing structured logs emitted on key endpoints:
- `type=api_metric` for:
  - `/api/health`
  - mutation endpoints (`submit`, `actions`, `apply`, `rollback`)
  - proxy endpoints (`tile`, `geocode`)

Alerting needs:
- request count by route/method/status,
- latency distribution or p95 proxies from durationMs,
- correlation/requestId presence.

### 3.2 Incident definition

We define incidents as sustained SLO or contract degradation that requires human intervention.

P1 (major incident):
- `GET /api/health` returns non-200 for > 2 minutes, or
- sustained `5xx rate` on mutation endpoints exceeds the team threshold for > 5 minutes, or
- rollback/apply failure ratio > threshold for > 5 minutes (signals corruption risk).

P2 (degraded service):
- sustained `429 spike` on mutation endpoints indicating abusive load (must confirm it’s expected traffic first), or
- proxy routes (`tile/geocode`) show sustained failures/timeout spikes leading to user-visible map degradation.

P3 (minor / watch):
- brief latency regressions within SLO, or
- non-critical error logs without sustained user impact.

### 3.3 Alert rules (baseline)

Baseline alert examples (tune by real load after first production week):
- `health_unhealthy`: health probe != 200 for 2–3 consecutive minutes.
- `mutation_5xx_rate`: mutation routes 5xx rate above N% for 5 minutes.
- `mutation_p95_latency`: p95 durationMs above SLO target for 10 minutes.
- `rollback_apply_failure_ratio`: apply/rollback endpoint error ratio above N% for 5 minutes.
- `proxy_timeouts`: sustained upstream timeout/error rate on `/api/tile` or `/api/geocode/*`.

## 4) Operational readiness gates (before enabling scale-up)

Before increasing instances beyond 2:
- confirm Redis (rate-limit shared state) plan is ready OR keep instances pinned to 1–2,
- verify alerts work end-to-end (at least for staging + load test smoke),
- validate correlationId presence in logs on mutation routes.

