# Структура репозитория и сущности сети (контекст для LLM)

Ниже — структура репозитория и все сущности сети, как они завязаны на БД, API и визуализацию. Это можно целиком переслать в DeepSeek как контекст.

**Состояние кода:** `CABLE_TYPES` в API — **четыре** линейных типа (подводные + подземные кабели); `NETWORK_ELEMENT_TYPES` в [`networkElementOps.ts`](../src/lib/stage7/networkElementOps.ts) совпадает с **полным** перечнем `NetworkElementType` в Prisma (**18** значений, без топологии/BRAS/OLT и пр.); 3D/2D и bbox согласованы. [`factories.ts`](../src/lib/three/factories.ts): `NODE_VISUALS`, `EQUIPMENT_FACTORIES`, `TYPE_LABELS_RU`, `CABLE_COLORS` — по ключам совпадают с enum в [`schema.prisma`](../prisma/schema.prisma). **`npm run db:enum-inspect`** — число строк **по каждой метке enum** (`LEFT JOIN`, в т.ч. `cnt = 0`).

## 1. Корень проекта (без `node_modules`)

| Путь | Назначение |
|------|------------|
| `src/` | Код приложения Next.js (App Router) |
| `prisma/` | `schema.prisma`, миграции, `seed.mjs` |
| `public/` | Статика, в т.ч. `public/textures/earth/` для глобуса |
| `scripts/` | Node-скрипты: импорт кабелей/спутников, смоки, синк новостей; `npm run db:enum-inspect` — подсчёт объектов по типам |
| `anchor/` | Solana Anchor (программа proposal-submission) |
| `docs/` | Архитектура, требования, промпты агентов (`docs/agents/`) |
| `.cursor/rules/` | Правила Cursor для координатора и журнала |
| Конфиги | `package.json`, `next.config.*`, `tsconfig.json`, `.env*` |

**Сборка:** `npm run build`, **dev:** `npm run dev`, **БД:** Prisma + PostgreSQL.

## 2. `src/app` — маршруты и API

### Страницы (UI)

- `src/app/page.tsx` — главная (глобус/карта).
- `src/app/global-network/`, `src/app/cables/` — разделы про сеть/кабели.
- `src/app/cabinet/` — профиль, username.
- `src/app/propose/`, `src/app/predlozhit/` — режим предложений.
- `src/app/networks/`, `src/app/networks/[id]/` — список/карточка proposal с 3D-просмотром.
- `src/app/sandbox/` — песочница типов сети.
- `src/app/moderate/` — модерация (allowlist).
- `src/app/about/`, `src/app/news/` — контент/новости.

### API (`src/app/api/`)

- `api/network/route.ts` — `GET /api/network` — основной источник сети для клиента.
- `api/auth/`, `api/profile/` — Phantom + профиль.
- `api/tile/`, `api/geocode/*` — прокси тайлов и геокодинга для Leaflet.
- `api/proposals/*` — proposals, actions, apply, rollback, submit (Stage 5–7/6).
- `api/moderation/*` — решения модератора.
- `api/health`, `api/news`, `api/cron/*` — здоровье, новости, cron.

## 3. `src/components` и `src/lib`

- `src/components/EarthScene.tsx` — Three.js: Земля + сеть (линии кабелей, маркеры узлов).
- `src/components/MapView.tsx` — Leaflet 2D, те же elements.
- `src/components/HomePage.tsx` — сборка сцены и карты.
- `src/lib/types.ts` — DTO: `NetworkElementDTO`, `NetworkProviderDTO`, `NetworkResponseDTO`, union `NetworkElementType` (должен совпадать с Prisma по смыслу).
- `src/lib/prisma.ts` — клиент Prisma.
- `src/lib/three/factories.ts` — `NODE_VISUALS`, `CABLE_COLORS`, `TYPE_LABELS_RU`, `EQUIPMENT_FACTORIES` — цвета, размеры, фабрики 3D-моделей по типу.
- `src/lib/three/` — утилиты глобуса (`globeAppearance.ts`, `globeMapSync.ts`, …).
- `src/lib/geo/` — bbox, нормализация координат, фильтрация сети.
- `src/lib/stage7/networkElementOps.ts` — валидация payload для CREATE/UPDATE элементов в proposals (важно: список допустимых типов здесь — см. раздел 6).

## 4. Доменная модель сети в БД (`prisma/schema.prisma`)

### 4.1. `Scope` (область данных)

- **GLOBAL** — глобальная сеть.
- **LOCAL** — локальная/региональная.

И `NetworkProvider`, и `NetworkElement` имеют поле `scope`.

### 4.2. `NetworkProvider`

Поставщик/источник данных о сегменте сети: `id`, `name`, `scope`, опционально `sourceUrl`.

Связь: у `NetworkElement` есть опциональный `providerId` → `NetworkProvider`.

### 4.3. `NetworkElement` — универсальная сущность «узел или линия»

| Поле | Смысл |
|------|--------|
| `id` | CUID |
| `scope` | `GLOBAL` / `LOCAL` |
| `type` | `NetworkElementType` (enum, см. ниже) |
| `providerId` | опциональная привязка к провайдеру |
| `name` | человекочитаемое имя |
| `sourceId` | уникальный внешний идентификатор из импорта (опционально, `@unique`) |
| `lat`, `lng` | точка на карте/глобусе (для узлов и объектов «в точке») |
| `altitude` | км над поверхностью (для спутников и т.п.; для `SATELLITE` в 3D есть fallback ~550 км) |
| `path` | JSON-массив точек `{ lat, lng }[]` — траектория кабеля (минимум 2 точки для отрисовки линии) |
| `metadata` | произвольный JSON — атрибуты для UI/карточек (имя кабеля, технические поля и т.д.) |

**Геометрия:**

- Кабели (`CABLE_*`): задаются через `path`, `lat`/`lng` у кабеля в выборке bbox могут не использоваться так же, как у узлов (API отдельно тянет кандидатов с `path`).
- Узлы (сервер, станция, спутник и т.д.): `lat` + `lng` обязательны для отображения; опционально `altitude`.

## 5. Enum `NetworkElementType` — все типы элементов сети

Источник истины: `prisma/schema.prisma`, зеркало для TS: `src/lib/types.ts`.

**Подводные кабели:** `CABLE_COPPER`, `CABLE_FIBER`

**Подземные кабели:** `CABLE_UNDERGROUND_COPPER`, `CABLE_UNDERGROUND_FIBER`

**Узлы / оборудование (телеком-логика):** `SERVER`, `SWITCH`, `MULTIPLEXER`, `DEMULTIPLEXER`, `REGENERATOR`, `MODEM`, `BASE_STATION`, `SATELLITE`, `EQUIPMENT` — обобщённое оборудование

**Офлайн / mesh / транзакции без постоянного онлайна:** `MESH_RELAY`, `SMS_GATEWAY`, `VSAT_TERMINAL`, `OFFLINE_QUEUE`

Других значений `NetworkElementType` в схеме нет.

## 6. Где типы используются в коде

### `GET /api/network` (`src/app/api/network/route.ts`)

- Кабели для bbox: типы из массива **`CABLE_TYPES`** = четыре `CABLE_*` (подводные + подземные), отбор по пересечению `path` с bbox.
- Точечные элементы: в bbox по `lat`/`lng`.
- Параметры: `scope`, `bbox=minLat,minLng,maxLat,maxLng`, опционально `z` (лимиты выборки).

### 3D (`EarthScene.tsx`)

- Кабели: четыре типа + непустой `path`; подземные — другой радиус сферы и пунктир (`LineDashedMaterial`).
- Узлы: по `NODE_VISUALS[type]`; если типа нет в карте — узел не рисуется.
- Спутник: особая высота, если нет `altitude`.

### 2D (`MapView.tsx`)

- Своя таблица цветов/радиусов для узлов (должна покрывать те же типы, что и 3D, для консистентности).

### `src/lib/three/factories.ts`

- Для узлов с «фигурой»: ключи в `EQUIPMENT_FACTORIES` (не все типы — например `SATELLITE` через отдельную функцию).
- Легенда/подписи: `TYPE_LABELS_RU`, цвета кабелей: `CABLE_COLORS`.

### Proposals / apply (Stage 7) — `src/lib/stage7/networkElementOps.ts`

- Функция `isNetworkElementType` проверяет тип по внутреннему списку строк **`NETWORK_ELEMENT_TYPES`**.
- **Расширение:** при добавлении нового значения в `NetworkElementType` — миграция Prisma, затем этот массив, при необходимости `CABLE_TYPES`, карты в `factories.ts`, 2D/3D.

## 7. Связанные сущности (не «элемент сети», но часть домена)

- **User** — пользователь Solana (`pubkey`, `username`).
- **Proposal**, **ChangeAction**, **HistoryEntry**, **Vote**, **ModerationDecision** — предложения изменений сети, голосование, история apply/rollback, модерация.
- **NewsCache** — кеш новостей для `/news`.

## 8. Импорт данных и seed

- `prisma/seed.mjs` — демо-спутник, вызовы скриптов импорта (подводные/подземные кабели, базовые станции, спутники) с лимитами через env (`SEED_*`).
- `scripts/` — например `sync-underground-cables.mjs`, `sync-submarine-cables` (в `package.json` как `scripts:sync-cables`), спутники, смоки сети.

При импорте обычно заполняют: `type`, `scope`, `path` или `lat`/`lng`, `sourceId`, `metadata`, связь с `NetworkProvider`.

## 9. Чеклист для добавления нового типа элемента

1. Добавить значение в enum `NetworkElementType` в `prisma/schema.prisma`, сделать миграцию, `prisma generate`.
2. Добавить то же имя в union `NetworkElementType` в `src/lib/types.ts`.
3. Если тип — кабель (линия по `path`): включить в **`CABLE_TYPES`** в `src/app/api/network/route.ts` (иначе bbox-фильтрация кабелей его не подхватит).
4. Обновить `NODE_VISUALS`, при необходимости `EQUIPMENT_FACTORIES`, `TYPE_LABELS_RU`; для кабелей — `CABLE_COLORS`.
5. Синхронизировать **`NETWORK_ELEMENT_TYPES`** в `src/lib/stage7/networkElementOps.ts`, если тип должен проходить через proposals.
6. Добавить стиль в `MapView.tsx` (2D), проверить `EarthScene.tsx` / `sandbox`.

Краткая ссылка на проектный документ с похожим содержанием: [`docs/global-network-building-spec.md`](./global-network-building-spec.md) (если нужно углубить процесс импорта и `metadata`).

---

В `DEVELOPMENT_JOURNAL.md` добавлена короткая отметка об этой справке (по правилам репозитория).
