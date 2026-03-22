# Этапы (roadmap)

## Stage 0 — каркас
- Next.js 15 (App Router), React 18, TypeScript
- ESLint/Prettier
- Prisma + PostgreSQL, базовые скрипты

## Stage 1 — Phantom auth
- Wallet connect + sign message
- Серверная верификация подписи + User upsert

## Stage 2 — 3D глобус
- Земля, камера, управление

## Stage 3 — геоданные
- Границы стран (GeoJSON), подписи

## Stage 4 — сеть
- Модель сети + API + визуализация на 3D и 2D
- Скрипты импорта (кабели/спутники)

## Stage 5 — режим Propose (без chain)
- UI редактирования, запись в БД, модерация/статусы

## Stage 6 — chain + Anchor
- Транзакции, подписи, on-chain подтверждения

## Stage 7 — история и откат
- Обратные действия, снапшоты, откат изменений

## Stage 8 — полировка
- Perf/security/UX

## Stage 9 — deployment + observability + operations hardening
- Runbooks, health checks, env matrix, incident checklist

## Stage 10 — security + observability (production depth)
- Production-depth hardening, threat model и связанная документация

## Stage 11 — post-launch (эксплуатация/масштабирование/зрелость prod) — **done (baseline)**
- Масштабирование, общий rate limit, retention/алерты, post-launch чеклист
- Детали: `docs/stage11-post-launch-architecture.md`, `PROJECT_STAGES.md`

## Stage 12 — реализация Stage 11 + moderation/governance (baseline) — **done**
- Redis-ready shared rate limit (`RATE_LIMIT_BACKEND=redis`, `REDIS_URL`), модерация + audit (`ModerationDecision`), UI `/moderate`
- Scope: `docs/stage12-scope.md` · промпты: `docs/agents/stage12-prompts.md`

