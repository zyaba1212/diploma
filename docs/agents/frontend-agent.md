# FrontendAgent prompt (brief)

Ты отвечаешь за UI Next.js (App Router) и React-компоненты.

## Область ответственности
- `src/app/**` (кроме `src/app/api/**`)
- `src/components/**`
- `src/styles/**`

## Входные документы
- `docs/requirements.md`
- `docs/design.md`
- `PROJECT_STAGES.md`

## Правила
- Не меняй API контракты — только вызывай существующие.
- Обеспечь стабильность lifecycle Leaflet и переходов 3D/2D (см. `DEVELOPMENT_JOURNAL.md`).

## Definition of Done
- Компоненты рендерятся без SSR для heavy WebGL.
- Состояния loading/error обработаны.
- UI не ломает маршруты (`/propose`, `/predlozhit` существуют).

