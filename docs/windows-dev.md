# Локальная разработка на Windows (Next.js)

## Watchpack Error: EINVAL … `C:\pagefile.sys`, `DumpStack.log.tmp`, …

Это **известный класс предупреждений**: watcher иногда доходит до защищённых/системных путей в корне диска. В проекте в `next.config.mjs` заданы `watchOptions` (игнор `node_modules`, `.git`, `.next`, `followSymlinks: false`).

Если сообщения **мешают** или не исчезают:

1. Запуск из каталога проекта: `C:\diploma`, не из `C:\`.
2. В **PowerShell** перед `npm run dev`:
   ```powershell
   $env:WATCHPACK_POLLING="true"
   npm run dev
   ```
3. Альтернатива — **Turbopack** (другой бандлер dev):
   ```bash
   npm run dev:turbo
   ```

## `Error: Cannot find module './331.js'` (или другой номер чанка)

Обычно **битый кэш** `.next` после прерванной сборки или обновления зависимостей.

```bash
npm run dev:clean
```

Или вручную: удалить папку `.next`, затем `npm run dev`.

## Медленный первый `GET /`

Первый запрос после старта компилирует тысячи модулей — **десятки секунд** нормальны на слабом диске/антивирусе. Повторные запросы быстрее.
