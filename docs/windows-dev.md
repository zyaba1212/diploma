# Локальная разработка на Windows (Next.js)

## Watchpack Error: EINVAL … `C:\pagefile.sys`, `DumpStack.log.tmp`, …

### Root cause
Это не пользовательский watcher из кода проекта. Ошибка возникает в dev-стеке webpack/Watchpack на Windows в фазе `initial scan`: при обходе директорий Watchpack может сделать `lstat` системных объектов в корне диска до того, как полностью отработают правила `ignored`.

### Принятый инженерный workflow (без маскировки)
1. По умолчанию запускать dev через Turbopack:
   ```bash
   npm run dev
   ```
   (`dev` теперь указывает на `next dev --turbo`).
2. Webpack-dev оставлен как диагностический fallback:
   ```bash
   npm run dev:webpack
   ```
3. Для чистого старта:
   ```bash
   npm run dev:clean
   ```
4. Запуск только из корня проекта (`C:\diploma2\diploma`), не из `C:\`.

### Когда использовать webpack fallback
- Нужно проверить поведение, специфичное для webpack-пайплайна.
- Нужно подтвердить/сравнить воспроизводимость Watchpack EINVAL в диагностике.

## `Error: Cannot find module './331.js'` (или другой номер чанка)

Обычно **битый кэш** `.next` после прерванной сборки или обновления зависимостей.

В `next.config.mjs` для **dev** включён **in-memory** webpack cache (без файлов `*.pack.gz` в `.next/cache/webpack`), чтобы реже ловить рассинхрон чанков на Windows при антивирусе или прерванных записах.

```bash
npm run dev:clean
```

Или вручную: удалить папку `.next`, затем `npm run dev`.

Если ошибки повторяются: один процесс `next dev`, папка проекта в **исключениях** антивируса, и проверка на `npm run dev:webpack` только для локализации отличий webpack/turbo.

## `ENOENT: routes-manifest.json` в `.next`

То же, что и битый кэш: папка `.next` неполная (прервали `dev`/`build`, антивирус подчистил файлы, двойной `next dev`).

```bash
npm run dev:clean
```

Скрипт удаляет `.next` и снова поднимает dev с `--hostname 0.0.0.0`. Закройте старый процесс `node`/`next` перед повторным запуском.

## Медленный первый `GET /`

Первый запрос после старта компилирует тысячи модулей — **десятки секунд** нормальны на слабом диске/антивирусе. Повторные запросы быстрее.
