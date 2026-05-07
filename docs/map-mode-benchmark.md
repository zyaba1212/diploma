# Benchmark режима карты (baseline / после оптимизаций)

Цель — измерить задержку подписи локации, ошибки тайлов и ощущение лагов при pan/zoom.

## Baseline до изменений (фиксация «до/после»)

Заполнить один раз **до** деплоя фиксов и повторить после canary.

| Метрика | Как снять | Значение до | Значение после |
|---------|-----------|-------------|----------------|
| Время до текста локации после pan ~500 m | Console `[map-perf]` или секундомер до появления подписи | | |
| Доля **429/502** по `/api/tile` | Network → фильтр `tile`, число ошибок / общее число запросов за сценарий | | |
| Ошибки reverse | Network → `/api/geocode/reverse`: статус, тело JSON (`code`, `error`), заголовок `x-geocode-code` | | |
| Визуал карты | Полная подложка без «кусочка» карты по краям после входа в **Карта** и после resize окна | ок / не ок | ок / не ок |

Сценарии: первое открытие `/global-network` → **Карта**; переключение **Глобус → Карта**; изменение ширины окна / DevTools dock; быстрый pan/zoom 10–15 с.

## Переменные окружения

| Переменная | Назначение |
|------------|------------|
| `NEXT_PUBLIC_MAP_PERF_DEBUG=1` | В консоли браузера JSON-строки `[map-perf]` при reverse geocode (`reverse_fetch_start`, `reverse_fetch_done`). |
| `TILE_DEBUG_LOG` | Сервер: см. [`docs/operations.md`](./operations.md) §4.5 — по умолчанию без спама по каждому успешному тайлу; `1`/`verbose` — полный лог. |

## Canary rollout (без регресса KPI)

1. Задеплоить на staging / preview с теми же env, что prod (или явно выставить `TILE_RATE_LIMIT_*`).
2. Включить на короткое время `TILE_DEBUG_LOG=1`, пройти сценарий из §«Ручной сценарий», убедиться в отсутствии всплесков `rate_limited` / `circuit_open` в логах.
3. Сравнить DevTools → Network по `/api/tile`: доля **429/502** до/после; цель **< 0.5%** при активной навигации.
4. Для геокода: при ошибках reverse смотреть JSON **`code`** / заголовок **`x-geocode-code`** (`geocode_upstream_timeout`, `geocode_circuit_open`, …) и structured logs `scope:geocode`.
5. Откат: вернуть предыдущий деплой; при необходимости снизить `TILE_RATE_LIMIT_MAX` или ужесточить circuit в [`tileConstants.ts`](../src/lib/tile/tileConstants.ts). Таймауты клиента/upstream задаются в [`src/lib/geocode/constants.ts`](../src/lib/geocode/constants.ts) (`GEOCODE_CLIENT_FETCH_TIMEOUT_MS`, `GEOCODE_UPSTREAM_TIMEOUT_MS`) — откат через предыдущую версию файла или revert коммита.

## Ручной сценарий (браузер)

1. Открыть `/global-network`, режим **Карта**, DevTools → Console.
2. Очистить консоль, выполнить pan на ~500 m, остановиться — зафиксировать время до появления текста локации (или события `reverse_fetch_done`).
3. Быстрый pan/zoom 10 с — визуально оценить серые тайлы и FPS.
4. Вкладка Network: фильтр `tile` — считать долю **429/502** среди запросов `/api/tile`.

## Пустой viewport MAP_2D (`elements: 0`)

Цель — не путать **отсутствие данных в окне** с ошибкой сети и не допускать «мигания» empty-state при быстром pan/zoom.

### Acceptance (локально / staging)

| Проверка | Pass |
|----------|------|
| bbox с данными → маркеры/линии видны, баннер «В этом регионе данных нет» **скрыт** | ☐ |
| bbox без данных → баннер **виден**, в панели «Данные» **нет** `network error` | ☐ |
| Быстрый pan/zoom → empty-state соответствует **последнему** завершённому запросу (нет подсказки от старого bbox) | ☐ |
| Карта **не** делает авто-pan/zoom при пустом ответе | ☐ |

### Верификация `meta` в `/api/network`

Для запросов с `bbox=` ответ включает опциональный блок **`meta`** (обратная совместимость: старые клиенты игнорируют):

- `meta.reason`: `ok` \| `empty_viewport` \| `filtered_out`
- `meta.worldish`: признак «широкого» окна (как на сервере)
- `meta.bbox`: эхо bbox `[minLat, minLng, maxLat, maxLng]`

Пример (подставить свой bbox без узлов в БД или океан):

```bash
curl -sS "http://localhost:3000/api/network?scope=GLOBAL&bbox=-5,-5,5,5&z=6" | jq '{elements: (.elements|length), meta}'
```

Ожидания:

- Непустой регион (известная инфраструктура): `.elements|length > 0`, `meta.reason == "ok"`.
- Реально пустое окно (нет кандидатов в bbox): `meta.reason == "empty_viewport"`.
- Кандидаты были, но отфильтрованы (dataset / underground): `meta.reason == "filtered_out"`.

### Canary / rollback сигналы

- **Регресс UX:** появление `network error` там, где раньше был просто пустой регион.
- **Регресс контракта:** клиенты, ожидающие только `{ providers, elements }`, должны работать без изменений; при сомнениях проверить JSON в Network → `api/network`.
- **Откат:** revert деплоя изменений [`route.ts`](../src/app/api/network/route.ts) / [`EarthScene.tsx`](../src/components/EarthScene.tsx) / типов.

## Сервер / curl (smoke)

Проверка доступности тайла и геокода (локально подставить хост):

```bash
curl -sS -o /dev/null -w "tile:%{http_code} time:%{time_total}\n" \
  "http://localhost:3000/api/tile?z=12&x=2376&y=1267&source=osm"

curl -sS -w "\ngeocode:%{http_code} time:%{time_total}\n" \
  "http://localhost:3000/api/geocode/reverse?lat=53.9&lng=27.56"
```

## Целевые KPI (из плана ускорения)

- Текст локации после остановки панорамы: **p95 < 1.2 s** (типичная сеть).
- Доля ответов `/api/tile` с **4xx/5xx** при активной навигации: **< 0.5%**.
- Нет длительных (≥ 1 s) серых областей подложки в типовом сценарии desktop.

## Tile API — логи на сервере

Структурированные строки с `"scope":"tile"` в stdout ([`src/lib/tile/observability.ts`](../src/lib/tile/observability.ts)). Полное отключение: **`TILE_DEBUG_LOG=0`**. Успешные тайлы по умолчанию **не** логируются (см. [`docs/operations.md`](./operations.md)); полный поток: **`TILE_DEBUG_LOG=1`**.
