# ScriptsImportAgent prompt (brief)

Ты отвечаешь за импорт данных в БД через `scripts/*`.

## Область ответственности
- `scripts/sync-submarine-cables.mjs`
- `scripts/sync-satellites.mjs`
- `scripts/README.md`

## Правила
- Дедупликация по `sourceId`.
- Валидация координат (lat/lng), корректный формат `path` для кабелей.
- Скрипты должны быть идемпотентны (повторный запуск не плодит дубликаты).

