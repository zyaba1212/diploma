# Database Operations Runbook (Stage 9-11)

This runbook is the DB baseline for production/stage operations.

## 1) Hot query indexes checklist

Before release, verify the following indexes exist:

- `Proposal_authorPubkey_status_idx`
- `Proposal_status_createdAt_idx`
- `Proposal_authorPubkey_status_createdAt_idx`
- `Proposal_onChainTxSignature_idx`
- `Proposal_onChainSubmittedAt_idx`
- `NetworkElement_scope_idx`
- `NetworkElement_lat_lng_idx`
- `NetworkElement_scope_lat_lng_idx`
- `HistoryEntry_proposalId_idx`
- `HistoryEntry_actionId_idx`
- `HistoryEntry_appliedAt_idx`
- `HistoryEntry_proposalId_appliedAt_idx`

Validation SQL:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('Proposal', 'NetworkElement', 'HistoryEntry')
ORDER BY tablename, indexname;
```

## 2) Backup / restore baseline (logical dump)

### Backup (full logical dump)

```bash
pg_dump "$DATABASE_URL" --format=custom --compress=9 --file=backup_$(date +%Y%m%d_%H%M%S).dump
```

### Backup (schema only)

```bash
pg_dump "$DATABASE_URL" --schema-only --file=schema_$(date +%Y%m%d_%H%M%S).sql
```

### Restore (full)

```bash
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$DATABASE_URL" backup_YYYYMMDD_HHMMSS.dump
```

### Restore verification (minimal)

```sql
SELECT COUNT(*) FROM "Proposal";
SELECT COUNT(*) FROM "ChangeAction";
SELECT COUNT(*) FROM "NetworkElement";
SELECT COUNT(*) FROM "HistoryEntry";
```

## 3) Migration policy

Use this policy consistently:

- `prisma migrate dev`:
  - local development only,
  - generates new migration files from schema changes.
- deploy migration (production/stage):
  - apply committed SQL migration artifacts from `prisma/migrations/**/migration.sql`,
  - no ad-hoc schema edits in production.

Recommended deployment order:

1. DB backup (`pg_dump`)
2. Apply migration SQL
3. Run app health checks
4. Run smoke checks for proposals/history endpoints

## 4) Referential integrity checks for rollback/history flow

Current runtime history writes are done via raw SQL helper (`src/lib/stage7/historyStore.ts`).
Because of this, integrity should be verified operationally.

Pre-deploy check (or periodic job):

```sql
-- Orphan history entries by proposalId:
SELECT h.id, h."proposalId"
FROM "HistoryEntry" h
LEFT JOIN "Proposal" p ON p.id = h."proposalId"
WHERE p.id IS NULL;

-- Orphan history entries by actionId:
SELECT h.id, h."actionId"
FROM "HistoryEntry" h
LEFT JOIN "ChangeAction" a ON a.id = h."actionId"
WHERE a.id IS NULL;
```

Expected result: zero rows.

Rollback safety check:

```sql
SELECT id, "proposalId", "actionId", "appliedAt", diff
FROM "HistoryEntry"
WHERE jsonb_typeof(diff) <> 'object'
   OR (diff->>'kind') NOT IN ('CREATE', 'UPDATE', 'DELETE');
```

Expected result: zero rows.

## 5) Unified approach (Stage 9 decision)

For now, `HistoryEntry` runtime writes/reads use raw SQL (`historyStore`), while Prisma schema keeps a compatible model and indexes.
Do not mix two different table shapes. If migrating to Prisma-only history access later, do it in a dedicated change with:

- code switch from raw SQL to Prisma client,
- one migration ensuring table/constraints/indexes match Prisma model,
- explicit data compatibility check.

## 6) Security baseline (Stage 10)

### Least privilege (production DB role)

Use a dedicated application role for `DATABASE_URL` (not superuser):

- Must have: `CONNECT`, `USAGE` on schema, and DML rights only on required tables.
- Must not have: `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `BYPASSRLS`, `REPLICATION`.
- Migration role can be separate from runtime app role.

Minimal SQL example:

```sql
-- Example only; adjust role names/password management for your environment.
CREATE ROLE app_runtime LOGIN PASSWORD 'REPLACE_ME_NORMALLY_FROM_SECRET_STORE' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE your_db TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
```

### TLS / connection encryption (`DATABASE_URL`)

For managed Postgres or network boundaries outside localhost, require SSL:

- Recommended: `?sslmode=require`
- Stricter (with CA validation): `?sslmode=verify-full` and proper CA chain on client host.

Examples:

```text
postgresql://app_runtime:<password>@db-host:5432/diploma?schema=public&sslmode=require
postgresql://app_runtime:<password>@db-host:5432/diploma?schema=public&sslmode=verify-full
```

Notes:
- Keep `sslmode` explicit in production to avoid silent non-TLS downgrade.
- Never commit real credentials in repository or logs.

## 7) Heavy-query index audit workflow (Stage 10)

Run periodically (or before major releases):

```sql
-- Find expensive statements (requires pg_stat_statements extension enabled):
SELECT query, calls, total_exec_time, mean_exec_time, rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 25;
```

Then confirm target queries use indexes:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, "proposalId", "actionId", "appliedAt"
FROM "HistoryEntry"
WHERE "proposalId" = '<proposal-id>'
ORDER BY "appliedAt" DESC
LIMIT 50;
```

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, scope, type, lat, lng
FROM "NetworkElement"
WHERE scope = 'GLOBAL'
  AND lat BETWEEN -10 AND 10
  AND lng BETWEEN 20 AND 40;
```

If sequential scans dominate under load, revisit composite indexes before scale-up.

## 8) Rollback integrity hardening checklist (Stage 10)

Before release:

- Orphan checks return zero rows (section 4).
- `diff.kind` validity check returns zero rows (section 4).
- Verify index `HistoryEntry_proposalId_appliedAt_idx` exists and is used by latest-history queries.
- Keep apply/rollback in DB transaction boundaries on backend side (already expected by Stage 7 handlers).

## 9) Stage 11 (post-launch) — DB scaling & maturity

### 9.1 Connection pooling (PgBouncer / managed pooler)

Goal: reduce DB connection churn and stabilize latency under multi-instance traffic.

Recommendations:

- Use a connection pooler in front of Postgres (e.g. PgBouncer) and point `DATABASE_URL` to the pooler host/port.
- Prefer PgBouncer `pool_mode=transaction` for typical web workloads.
- Ensure application-level queries do not rely on session state (temp tables, session variables), since transaction pooling can differ from session pooling.
- Apply SSL encryption in production:
  - set `DATABASE_URL` with `sslmode=require` (or `verify-full` in stricter environments).

Operational checklist:

- Verify that the number of active connections to Postgres stays within safe limits (monitor `pg_stat_activity`).
- Verify that Prisma/Node does not spike connection count on deploy/restart cycles.

### 9.2 Indexes for real traffic (proposals list + network bbox)

Hot queries expected by production:

- `GET /api/proposals` filtered by `authorPubkey` and `status` ordered by `createdAt`.
- `GET /api/network` filtered by `scope` and `bbox` (lat/lng ranges).
- `GET /api/proposals/:id/history` latest entries (`proposalId` ordered by `appliedAt` DESC LIMIT).

Validation steps (run in staging with production-like data volume):

- Confirm `Proposal` composite indexes are used for proposals list:
  - `EXPLAIN (ANALYZE, BUFFERS) SELECT ... FROM "Proposal" WHERE ... AND "status"=... ORDER BY "createdAt" DESC`
- Confirm `NetworkElement` bbox selection benefits from scope+lat/lng indexes:
  - `EXPLAIN (ANALYZE, BUFFERS) SELECT ... FROM "NetworkElement" WHERE "scope"=... AND lat BETWEEN ... AND lng BETWEEN ...`
- Confirm history “latest” queries use `HistoryEntry(proposalId, appliedAt DESC)` index.

If you see sequential scans consistently under load:
- increase selectivity (narrower bbox ranges),
- consider adding more targeted composite indexes aligned with actual query predicates,
- revisit query structure / ORM-generated SQL.

### 9.3 Migration policy for zero-downtime (expand/contract)

For production readiness, use a backwards-compatible migration lifecycle:

1. Expand (safe schema add)
   - add new nullable columns / new enum values (if needed) without breaking old code paths.
   - add indexes concurrently when possible (DB-operator dependent).
2. Deploy (dual-read / dual-write if required)
   - update application to write to new columns while still reading old ones if needed.
3. Backfill (optional)
   - run backfill jobs separately from deploy when data volume is large.
4. Contract (cleanup)
   - after confirming correctness, tighten constraints (NOT NULL, foreign keys) and/or drop obsolete columns in a later release.

Operational policy for this repo:
- local: `npm run prisma:migrate` / `prisma migrate dev` only for dev iteration.
- stage/prod: apply committed SQL migration artifacts from `prisma/migrations/**/migration.sql`.
- never perform ad-hoc schema edits in production; always record planned changes and verify with rollback-drill before traffic cutover.

