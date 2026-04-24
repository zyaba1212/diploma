# Локальная разработка на Windows (Next.js)

## Watchpack Error: EINVAL … `C:\pagefile.sys`, `DumpStack.log.tmp`, …

Это **известный класс предупреждений**: watcher иногда доходит до защищённых/системных путей в корне диска. В проекте в `next.config.mjs` заданы `watchOptions` (игнор `node_modules`, `.git`, `.next`, `followSymlinks: false`).

Если сообщения **мешают** или не исчезают:

1. Запуск из каталога проекта (корень репозитория, например `C:\diploma2\diploma`), не из `C:\`.
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

В `next.config.mjs` для **dev** включён **in-memory** webpack cache (без файлов `*.pack.gz` в `.next/cache/webpack`), чтобы реже ловить рассинхрон чанков на Windows при антивирусе или прерванных записах.

```bash
npm run dev:clean
```

Или вручную: удалить папку `.next`, затем `npm run dev`.

Если ошибки повторяются: один процесс `next dev`, папка проекта в **исключениях** антивируса, либо **`npm run dev:turbo`** (Turbopack, без webpack dev cache).

## `ENOENT: routes-manifest.json` в `.next`

То же, что и битый кэш: папка `.next` неполная (прервали `dev`/`build`, антивирус подчистил файлы, двойной `next dev`).

```bash
npm run dev:clean
```

Скрипт удаляет `.next` и снова поднимает dev с `--hostname 0.0.0.0`. Закройте старый процесс `node`/`next` перед повторным запуском.

## Медленный первый `GET /`

Первый запрос после старта компилирует тысячи модулей — **десятки секунд** нормальны на слабом диске/антивирусе. Повторные запросы быстрее.
