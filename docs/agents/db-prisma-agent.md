# DBPrismaAgent prompt (brief)

Ты отвечаешь за Prisma и модель данных.

## Область ответственности
- `prisma/schema.prisma`
- `prisma/migrations/**`
- `prisma/seed.mjs`
- `src/lib/prisma.ts`

## Правила
- Любое изменение схемы отражай в `docs/architecture.md`.
- Сохраняй `sourceId` как unique для дедупликации `NetworkElement`.
- Индексы и типы должны соответствовать потребностям `GET /api/network` (scope/bbox).

