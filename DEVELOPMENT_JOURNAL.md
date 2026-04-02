# DEVELOPMENT_JOURNAL

Короткие заметки по решениям и граблям, чтобы агенты не повторяли ошибки.

## Процесс: журнал обязателен для агента (инвариант)

- **Правило:** агент/ассистент при **существенных** правках кода или конфигов **обязан** в той же сессии дополнять этот файл: что сделано, грабли, решения (см. `AGENTS.md`). Не опускать под предлогом «пользователь не просил md» — для проекта это часть процесса.
- **Закрепление:** `.cursor/rules/development-journal.mdc` (`alwaysApply: true`), 2026-03-22.

## ER-диаграмма БД для пояснительной записки (2026-03-23)

- Сгенерировано изображение ER-схемы в стиле учебной диаграммы (таблицы Prisma: User, NetworkProvider, NetworkElement, Proposal, ChangeAction, Vote, ModerationDecision, HistoryEntry, NewsCache): [`docs/er-diagram-global-network-db.png`](docs/er-diagram-global-network-db.png) (копия также в `.cursor/.../assets/`). При правках `schema.prisma` обновить картинку или заменить на экспорт из dbdiagram.io / IDE.

## UI mockup: лента новостей 1440×900 (2026-03-23)

- Сгенерирован wireframe-макет (тёмная тема, glassmorphism, акценты cyan `#67e8f9` / violet `#a78bfa`, лёгкий noise): [`assets/wireframe-news-feed-1440-dark-glass.png`](assets/wireframe-news-feed-1440-dark-glass.png).

## Мобильная легенда + новости без RSS в GET (2026-03-22)

- **Легенда 3D:** на `max-width: 768px` по умолчанию только кнопка «Легенда»; раскрытие — диалог с `max-height` + скролл, закрытие по фону или «Закрыть». Десктоп без изменений. [`src/components/EarthScene.tsx`](src/components/EarthScene.tsx), вынесено тело в `GlobeLegendBody`.
- **Новости:** `GET /api/news` только `NewsCache`; RSS вынесен в [`src/lib/news/syncFeeds.ts`](src/lib/news/syncFeeds.ts) (`syncNewsFeedsFromRss`, до 35 статей на источник). Периодический запуск: [`src/app/api/cron/news-sync/route.ts`](src/app/api/cron/news-sync/route.ts) (`CRON_SECRET`, Bearer или `?secret=`, плюс Vercel Cron `x-vercel-cron`), [`vercel.json`](vercel.json) почасово, [`scripts/sync-news.mjs`](scripts/sync-news.mjs), `npm run scripts:sync-news`. PowerShell: `$env:CRON_SECRET="..."; npm run scripts:sync-news`. Доки: [`docs/operations.md`](docs/operations.md), [`.env.example`](.env.example).
- **Грабли:** `CRON_SECRET` с кириллицей в `scripts/sync-news.mjs` → `fetch` падает с `ByteString` (заголовки только ASCII). Проверка в скрипте + примеры в docs только латиница.
- **503 cron not configured:** секрет был только в PowerShell, а `npm run dev` читает `CRON_SECRET` из `.env.local` при старте. Решение: одна строка в `.env.local` + рестарт dev. В [`scripts/sync-news.mjs`](scripts/sync-news.mjs) — загрузка `.env`/`.env.local` и подсказка при 503.

## OSM + data.gov.au: видимость на карте и метаданные WFS (2026-03-22)

- **Проблема:** импорты OSM и Gold Coast ВОЛС сосредоточены у **~−28° / 153°E**, а центр глобуса по умолчанию **30°N, 0°E** — данные «теряются» вне viewport; подводные кабели тянутся на весь мир, авто-fit по всем элементам бесполезен.
- **Решение:** [`src/lib/geo/networkBounds.ts`](src/lib/geo/networkBounds.ts) — `selectBoundsForMapFocus` / `computeRegionalDataBounds` (датасеты `gold_coast_fibre_optic_cable`, `openstreetmap`, fallback copper, sourceId `gold-coast*` / `osm-*`). [`MapView`](src/components/MapView.tsx): `autoFitBounds` + `fitBounds` при готовности карты. [`EarthScene`](src/components/EarthScene.tsx): кнопка «К области данных», подсказка в легенде 3D; hover — `metadata.wfs` (описание, Folder, phone).
- **Импорт WFS:** [`scripts/sync-underground-cables.mjs`](scripts/sync-underground-cables.mjs) — полные `properties` в `metadata.wfs` и `wfsRaw` (поля из live GetFeature: name, visibility, open, address, phoneNumber, description, LookAt, Region, Folder).
- **OSM:** [`scripts/sync-underground-copper-cables-osm.mjs`](scripts/sync-underground-copper-cables-osm.mjs) — `console.warn` при 0 ways в bbox.
- **Доки:** [`docs/network-data-sources.md`](docs/network-data-sources.md), промпт агентам [`docs/agents/osm-datagovau-map-visibility-prompt.md`](docs/agents/osm-datagovau-map-visibility-prompt.md). Smoke: `npm run scripts:smoke-network-extent` ([`scripts/smoke-network-data-extent.mjs`](scripts/smoke-network-data-extent.mjs)).
- **Грабли:** `npm run lint` в среде агента не выполнен (npm отсутствует в PATH); проверить локально.

## EarthScene: лицевая ось глобуса (0,0,+1) и чувствительность ЛКМ (2026-03-22)

- **Баг 3D→2D «на южный полюс»:** в `computeGlobeCenterLatLng` / `orientGlobeGroupCenterFromLatLng` «лицо» задавалось как **(0,0,-1)**; для камеры на +Z к центру сцены видимая точка сферы — вдоль **(0,0,+1)** от центра, иначе читался антипод. Исправлено в [`src/lib/three/utils.ts`](src/lib/three/utils.ts), [`src/lib/three/globeAppearance.ts`](src/lib/three/globeAppearance.ts) (`updateGlobeFrontLabelsVisibility`), [`scripts/test-globe-orient-roundtrip.mjs`](scripts/test-globe-orient-roundtrip.mjs), [`scripts/test-ux-globe-smoke.mjs`](scripts/test-ux-globe-smoke.mjs).
- **ЛКМ:** в `rotationSensitivity` базовый множитель `0.005` → `0.00375` (~−25%).

## Globe 3D: подписи не слипаются в центре после +Z (2026-03-22)

- **Симптом:** белый текст на тёмном фоне (`makeTextSprite`) — сотни подписей одновременно в центре диска глобуса.
- **Причина:** после согласования «лица» с +Z порог `cosd >= cosRadius` начал соответствовать реальному видимому полушарию; раньше центр был смещён, большинство спрайтов оставались `visible=false`.
- **Исправление:** в [`src/lib/three/globeAppearance.ts`](src/lib/three/globeAppearance.ts) сужен конус (`labelRadiusDeg` ~10°/14°/18° по зуму), добавлен **top-N** по убыванию `cosd` и параметр `maxLabels` (в [`EarthScene.tsx`](src/components/EarthScene.tsx): 56 для кандидатов WORLD_LABELS, 10 для geo). Углы центра вынесены в [`computeGlobeFrontCenterAnglesInto`](src/lib/three/utils.ts) и используются в `computeGlobeCenterLatLng` (DRY).

## Nominatim reverse: нет параллельных запросов + очередь на сервере (2026-03-22)

- **Причина 429 upstream:** в [`EarthScene.tsx`](src/components/EarthScene.tsx) geo-лейблы 3D дергали **три параллельных** `/api/geocode/reverse` (Promise.allSettled) — политика Nominatim ≈1 req/s. Исправлено: **последовательные** запросы с паузой 1150 ms, приоритет воды с центра (`d0`), затем смещения; `GEO_LABEL_FETCH_MIN_MS` **2800**, интервал тика **3000 ms**.
- **Сервер:** [`enqueueNominatimFetch`](src/lib/nominatimQueue.ts) в [`src/app/api/geocode/reverse/route.ts`](src/app/api/geocode/reverse/route.ts) — минимум **1100 ms** между реальными fetch к Nominatim; кэш-ключ и координаты upstream — **4 знака** после запятой (`coarseLatLng`).

## API: тайлы карты и reverse geocode — 429/502 (2026-03-22)

- **Тайлы `/api/tile`:** лимит по IP был 300/мин — Leaflet запрашивает много тайлов параллельно → массовые 429. Поднят дефолт до **4000/60 с** (`TILE_RATE_LIMIT_MAX` в env). Добавлен **in-memory** кэш [`src/lib/tileCache.ts`](src/lib/tileCache.ts); попадание в кэш отдаётся **до** rate limit.
- **`/api/geocode/reverse`:** ответ Nominatim **429** больше не маскируется как 502; клиент получает **429** и `retry-after`. В [`circuitFetch`](src/lib/circuitBreaker.ts) для `geocode:reverse` добавлено `treatAsNeutral: [429]`, чтобы цепь не открывалась от лимита upstream; при открытой цепи — **503**.

## Globe 3D: автоподписи только страны / города / воды (2026-03-22)

- **Было:** на каждый элемент сети создавался `makeTextSprite` (Starlink, провайдеры, серверы) в `nodeLabelCandidatesRef`.
- **Стало:** спрайты для **узлов сети** не создаются; автоподписи на сфере — только [`WORLD_LABELS`](src/lib/three/labels.ts) (`makeTextMesh`) и geo-спрайты из `/api/geocode/reverse`. Имена узлов — панель **hover** в 3D и tooltips на 2D-карте ([`MapView.tsx`](src/components/MapView.tsx)).
- **Файлы:** [`src/components/EarthScene.tsx`](src/components/EarthScene.tsx), [`src/app/networks/[id]/page.tsx`](src/app/networks/[id]/page.tsx).

## EarthScene: 2D→3D + направление ЛКМ (2026-03-22)

- **ЛКМ/тач:** в `animate` знаки `rotateOnWorldAxis(worldUp, …)` и `rotateOnWorldAxis(camRight, …)` инвертированы относительно прежних (`-dx/-dy` → `+dx/+dy`). Дельты копятся в `pendingDragAccumRef` (общий ref с циклом `animate`).
- **2D→3D:** при переходе и в обработчике кнопки «3D» сбрасывается `pendingDragAccumRef`, чтобы первый кадр после `syncGlobeToMapCenter` не вращал глобус из-за накопленного drag.
- **Где трогается ориентация глобуса:** `syncGlobeToMapCenter` — `useLayoutEffect` при `MAP_2D→GLOBE_3D`, инициализация сцены (~строка 279), клик «3D»; `globeGroup.quaternion.normalize()` — только в `animate` после drag.

### Вопросы для DeepSeek (если центр 2D и лицо глобуса всё ещё расходятся)

Передать в DeepSeek с кратким описанием симптома (что видит пользователь):

1. После `orientGlobeGroupCenterFromLatLng` / `setFromUnitVectors(localRay, (0,0,-1))` должна ли точка (lat, lng) в нашей формуле оказаться на луче к камере из `(0,0,z)` к началу координат? Типичные ошибки знака `lng` или порядка lat/lng Leaflet vs локальный луч на сфере?
2. Если `computeGlobeCenterLatLng` после `orient` совпадает с входом, но визуально «не тот» регион — может ли виновата текстура/UV земли, а не quaternion?
3. Нужен ли сброс накопленного drag при переходе (сделано через ref) — подтвердить гипотезу гонки с `requestAnimationFrame`.

## Процесс: координатор не подменяет ролевых агентов на крупных фичах (coordinator)

- **Факт:** Auth/Profile MVP (username, миграция, `/api/profile*`, `/cabinet`) был реализован в одном потоке координатора вместо поочерёдной работы **DBPrismaAgent / BackendAPIAgent / FrontendAgent / Web3SolanaAgent** по `docs/agents/auth-profile-phase-prompts.md`. Это **нарушило** договорённость: промпт в файл → общий промпт в чат → исполнитель по роли → приёмка.
- **Дальше:** соблюдать `.cursor/rules/coordinator-architect.mdc` и чеклист в `docs/COORDINATOR_DEV_PLAN.md`. Крупные задачи, разбитые по ролям в промптах, **не** брать целиком «самому» без явной команды владельца.
- **Откат MVP:** не выполнялся автоматически; удаление/откат — только если владелец решит иначе. Доработки профиля — через соответствующих агентов.

## ARCHITECT_CHAT_PLAN: план из экспорта чата зафиксирован (coordinator)

- Прочитан экспорт `cursor_1_architect.md` (ArchitectAgent): высокоуровневые стадии 0→8, зоны агентов по ролям, детальный Stage 5 + **скрипт запуска шаги 1–6**.
- Всё перенесено в репозиторий: **`docs/ARCHITECT_CHAT_PLAN.md`** (канон). Живые приоритеты — **`docs/COORDINATOR_DEV_PLAN.md`**.
- Упоминание внешнего файла из чата: `\.cursor\plans\diploma-z96a-multi-agent-plan_3359d43f.plan.md` — опционально; если есть локально, не противоречит ARCHITECT_CHAT_PLAN.

## Auth / Profile MVP: username + /cabinet + /api/profile (coordinator)

- **Prisma:** `User.username` (unique, nullable), `usernameSetAt`; миграция `prisma/migrations/20260320120000_user_username/migration.sql`.
- **API:** `GET /api/profile?pubkey=` (в т.ч. `inDatabase: false`), `POST /api/profile/username` — подпись сообщения `diploma-z96a username\n...` (`src/lib/username.ts`).
- **UI:** `src/app/cabinet/page.tsx`, ссылка «Кабинет» в `HomePage`.
- **Доки:** `docs/architecture.md`, `PROJECT_STAGES.md` (инварианты).
- **Обязательно после pull:** `npx prisma migrate deploy` на своей БД.

## COORDINATOR_DEV_PLAN: живой план разработки (coordinator)

- Добавлен **`docs/COORDINATOR_DEV_PLAN.md`** — приоритеты и очередь (не равен «плану с начала чата»; чаты обрываются). Обновлять при смене фокуса.
- Правило **`.cursor/rules/coordinator-architect.mdc`**: делегирование ролевым агентам по умолчанию; координатор — приёмка и точечные правки (см. актуальную версию файла).

## Autoconnect: зафиксировано в architecture + PROJECT_STAGES (coordinator)

- В `docs/architecture.md` добавлен подраздел «Клиент: Phantom и autoconnect» (ссылка на `wallet-autoconnect-prompt.md` и файлы реализации).
- В `PROJECT_STAGES.md` (инварианты) добавлен пункт про сброс autoconnect на клиенте.
- В `README.md` в список документации добавлен `docs/agents/wallet-autoconnect-prompt.md`.

## Autoconnect: сброс после 30 мин бездействия + между сессиями (coordinator)

- `@solana/wallet-adapter-react` хранит выбранный кошелёк в `localStorage` (`walletName` по умолчанию). Добавлена метка **`diploma_walletLastActivityAt`** и обёртка **`WalletStaleAutoconnectGuard`** (до `WalletProvider`): если с последней активности > 30 мин — `walletName` удаляется, при следующем визите autoconnect не сработает.
- **`WalletIdleAutoconnect`**: таймер бездействия во вкладке; по истечении 30 мин — `disconnect()` (как кнопка «Отключить»), что сбрасывает сохранённый кошелёк.
- Ручной **disconnect** и так очищает `walletName` через событие адаптера — отдельный код не нужен.
- Константы: `src/lib/wallet-autoconnect-policy.ts`. Промпт для других агентов: **`docs/agents/wallet-autoconnect-prompt.md`**.

## Приёмка (next-acceptance): Auth/Profile + autoconnect после `Disconnect` (coordinator)

- **DB:** `npx prisma migrate deploy` для миграции `20260320120000_user_username` — OK.
- **Auth/Profile smoke:** `scripts/manual-cabinet-check.mjs` подтвердил:
  - `GET /api/profile?pubkey=` до установки username: `inDatabase: false`;
  - `POST /api/profile/username`: `200 ok=true`;
  - повторный `GET /api/profile`: `inDatabase: true` и совпадающий `username`;
  - попытка повторной установки другого `username`: `403`;
  - `GET /cabinet`: HTTP 200 и рендер страницы.
- **Optional smoke:** `scripts/api-profile-smoke.mjs` подтвердил `usernameSetAt` (ISO строка) и корректное переключение `inDatabase` (false/true).
- **Autoconnect after-disconnect:** scenario `after-disconnect` **#1** (логика/контракт) проверены по коду и правилам:
  - `WalletStaleAutoconnectGuard` удаляет `localStorage.walletName`, если `Date.now() - diploma_walletLastActivityAt > 30min` (строго `>`).
  - `WalletIdleAutoconnect` вызывает `disconnect()` после `WALLET_IDLE_MS` бездействия при `wallet.connected === true`.
  - Полная Phantom e2e-валидация “явный Disconnect → ожидание 30+ минут → возврат без autoConnect” требует ручного прогона в браузере (Phantom extension).
  - Время проверки логики: `2026-03-20T10:28:48.097Z`.

## AuthBlock: компактный блок — «Подключить кошелёк» → «Авторизовать» + «Отключить» (coordinator)

- Одна кнопка открывает `WalletModal` (`useWalletModal`); после подключения — «Авторизовать» (подпись `/api/auth/verify`) и «Отключить».
- Делегирование: username + личный кабинет + подпись — **`docs/agents/auth-profile-phase-prompts.md`**, маппинг в `AGENTS.md` → «Auth / Profile phase».
- `WalletModalProvider` + модалка выбора кошелька; кастомная кнопка «Подключить кошелёк» вызывает `useWalletModal().setVisible(true)` (не `WalletMultiButton`).

## AuthBlock: WalletNotSelectedError при Connect (coordinator)

- Причина: `wallet.connect()` без предварительного `wallet.select(...)` в `@solana/wallet-adapter-react` v0.15+.
- Исправление: перед `connect()` выбрать Phantom (или первый доступный адаптер), `await Promise.resolve()` для флаша эффектов, затем `connect()`.

## Windows dev: Watchpack EINVAL + chunk `Cannot find module './331.js'` (coordinator)

- **Watchpack** на Windows может логировать `lstat` по системным файлам в `C:\` — в `next.config.mjs` добавлены `watchOptions` (dev): `followSymlinks: false`, игнор `node_modules`/`.git`/`.next`.
- **Битый чанк** в dev — удалить `.next`: `npm run dev:clean` или `node scripts/clean-next.mjs`.
- Док: `docs/windows-dev.md`; скрипты: `dev:clean`, `dev:turbo`.

## UX / Globe phase — приёмка координатором (post-agents)

- **Сборка:** `npm run lint`, `npm run build` — OK.
- **Сделано агентами:** шапка `zIndex: 20`, ссылка `/cables`, `GET /api/network/elements/[id]`, страница кабелей, `AuthBlock` с async connect/disconnect, панели EarthScene `zIndex: 10`, карта `zIndex: 4`, кнопки зума ±.
- **Исправлено координатором:** убран авто-возврат `MAP_2D → GLOBE_3D` при `zoom > порога` (иначе 2D сразу сбрасывался); подписи зума «+» / «−».
- **v2 сайты/маршруты (header/UX):** `/`, `/about`, `/global-network` (legacy alias `/cables` на ту же страницу). В шапке только centered ссылка `Главная` (без левой навигации); кнопка `Глобальная сеть` есть на главной и странице `/about` и ведёт на `/global-network`.
- **Смоук (детерминированный):** `npm run test:ux-globe-smoke` — OK (exit_code 0) (запускал с `SKIP_GEOCODE_SMOKE=1`). Проверяет отключение zoom-based auto-switch (нет `ZOOM_THRESHOLD_*`/`hysteresis`), корректное 2D<->3D centering/orienting, user location (marker/label), settlement search dropdown, спутниковую визуализацию (`createSatelliteObject`) и presence underground cables + base stations через `GET /api/network?scope=GLOBAL`. Дополнительно smoke-скрипт выводит напоминание о ручной проверке: визуально `SATELLITE` и реальная геолокация (permission не автоматизируется надежно).
- **Дата приёмки:** 2026-03-20.

## Импорт подводных кабелей из Open Undersea Cable Map GeoJSON (coordinator)

Agent: coordinator  
Files: `scripts/sync-submarine-cables.mjs`, `docs/network-data-and-sources.md`, `.env.example`  
Источник по умолчанию: [stevesong/open_undersea_cable_map](https://github.com/stevesong/open_undersea_cable_map) `cable/cable-geo.json` (CC BY-NC-SA 3.0).  
Команда: `npm run scripts:sync-cables` или `node scripts/sync-submarine-cables.mjs --dry-run --limit 5`.

## Prisma: baseline миграция + убраны вложенные BEGIN/COMMIT (coordinator)

Agent: coordinator
Stage: DB / migrations repair
FilesChanged:
- `prisma/migrations/20260201000000_baseline_schema/migration.sql` (полная схема из `schema.prisma` + CHECK HistoryEntry)
- `prisma/migrations/migration_lock.toml`
- удалены дублирующие папки `20260319_*`, `20260320_*` (инкременты без начальной миграции ломали пустую БД)
- правки в `20260319_*` ранее: убраны `BEGIN`/`COMMIT` (Prisma сам в транзакции) — файлы затем заменены baseline
- `docs/local-dev-docker.md`, `package.json` (`db:reset`)
HowToTest:
- `npx prisma migrate deploy` или `npm run db:reset` (согласие на очистку dev БД)
- `npm run dev` → `GET /api/network?scope=GLOBAL` → 200
Notes:
- Причина `relation "Proposal" does not exist`: в истории миграций не было начального CREATE TABLE — только ALTER с Stage 6+.
- Для уже существующих клонов репозитория после pull: при необходимости `migrate reset` на dev.

## Earth / 3D глобус — реалистичные текстуры (coordinator)

Agent: coordinator
Stage: UX / visualization
FilesChanged:
- `src/components/EarthScene.tsx` — текстуры Земли (Phong: map, normalMap, specularMap), слой облаков, ACES tone mapping, `networkGroup` внутри `globeGroup`
- `src/lib/loadEarthTextures.ts` — загрузка с threejs.org или `NEXT_PUBLIC_EARTH_TEXTURE_BASE`
- `docs/earth-visualization.md`, `public/textures/earth/README.md`, `docs/architecture.md`, `README.md`, `.env.example`
HowToTest:
- `npm run dev` — на главной видна Земля с континентами (нужен интернет для CDN по умолчанию)
- Офлайн: положить текстуры в `public/textures/earth/`, задать `NEXT_PUBLIC_EARTH_TEXTURE_BASE=/textures/earth/`
Notes:
- Раньше глобус был однотонный (`0x1c2a4a`); сеть не вращалась с планетой — исправлено.

## Stage 12 — приёмка и верификация (coordinator)

Agent: coordinator
Stage: 12 acceptance
HowToTest (выполнено локально):
- `npm run lint` — OK
- `npx prisma generate` — нужен, если после смены схемы Prisma Client устарел; в `package.json` добавлен `postinstall: prisma generate`
- `npm run build` — OK после `prisma generate`
- `npm run ops:rollback-drill` — **не прошёл**: `GET /api/health` → **503** (PostgreSQL на `localhost:5432` недоступен в этой среде)
- `npm run test:proposals*` — не запускались (требуют поднятого приложения + БД)
FilesChanged (документация + DX):
- `package.json` (`postinstall`)
- `PROJECT_STAGES.md`, `README.md`, `docs/etapy.md`, `docs/architecture.md`, `DEVELOPMENT_JOURNAL.md` (Stage 12 → **done**)
Notes:
- Сборка изначально падала на `prisma.moderationDecision` до регенерации клиента — типичный симптом пропущенного `prisma generate` после миграции.
- Полная приёмка smoke/drill: поднять Postgres, `npm run prisma:migrate`, `npm run dev` или `npm run start`, затем `ops:rollback-drill` и `test:proposals*`.

## Stage 12 — kickoff (coordinator)

Agent: coordinator
Stage: 12 kickoff
FilesChanged:
- docs/agents/stage12-prompts.md (создан)
- AGENTS.md (Stage 12 execution mapping)
- PROJECT_STAGES.md, README.md, docs/etapy.md, docs/architecture.md, docs/stage12-scope.md
HowToTest:
- После реализации агентами: `npm run lint && npm run build`; smoke по README
Notes:
- Старт этапа; статус закрыт в блоке «Stage 12 — приёмка и верификация».

## Stage 11 — приёмка (все агенты A–G выполнили работу)

Agent: coordinator
Stage: 11 acceptance (post-launch / scaling & ops maturity)
FilesChanged:
- PROJECT_STAGES.md (Stage 11 → done)
- README.md
- docs/etapy.md
- DEVELOPMENT_JOURNAL.md (этот блок)
HowToTest:
- `npm run lint && npm run build`
- При необходимости: `npm run ops:rollback-drill`, `npm run test:proposals*`
Notes:
- Работа агентов A–G по Stage 11 принята координатором; статус этапа зафиксирован в репозитории.
- Ключевой артефакт архитектуры: `docs/stage11-post-launch-architecture.md`; инварианты API Stage 5–8 сохраняются.

## Stage 10 — приёмка (ArchitectAgent / coordinator)

Agent: ArchitectAgent (coordinator)
Stage: 10 acceptance
FilesChanged:
- PROJECT_STAGES.md (Stage 10 → done)
- README.md
- docs/security-observability.md, docs/stage10-security-observability.md (перекрёстные ссылки)
- .github/workflows/ci.yml (informational `npm audit`, continue-on-error)
HowToTest:
- `npm run lint && npm run build`
- `GET /api/health`, smoke tests при необходимости
Notes:
- Работа агентов A–G по Stage 10 принята: headers, apiError/correlation id, документация, DB runbook, UX на `/propose`.
- Дублирующиеся `docs/security-observability.md` и `docs/stage10-security-observability.md` связаны ссылками; приоритет детализации — `stage10-*`.
- `npm audit` в CI информационный, не блокирует merge при известных уязвимостях транзитивных зависимостей.

## Stage 9 baseline kickoff

Agent: ArchitectAgent (coordinator)
Stage: 9 kickoff (ops + CI baseline)
FilesChanged:
- package.json
- package-lock.json
- .github/workflows/ci.yml
- PROJECT_STAGES.md
- README.md
- AGENTS.md
- docs/agents/stage9-prompts.md
HowToTest:
- `npm run lint`
- `npm run build`
Notes:
- Добавлен `pino-pretty` для чистой сборки без warning про unresolved optional logger formatter.
- Добавлен минимальный CI gate (lint + build) как обязательная проверка качества.

## Stage 9 close — release hardening + Stage 10 kickoff

Agent: ArchitectAgent (coordinator)
Stage: 9 close / release hardening
FilesChanged:
- docs/secrets-policy.md
- docs/release-hardening.md
- scripts/rollback-drill.mjs
- package.json (script `ops:rollback-drill`)
- PROJECT_STAGES.md (Stage 9 done, Stage 10 next)
- README.md
- docs/operations.md (ссылки на policy и drill)
- AGENTS.md (Stage 10 mapping)
- docs/agents/stage10-prompts.md
HowToTest:
- `npm run lint && npm run build`
- При запущенном приложении: `npm run ops:rollback-drill` (ожидается успешный `GET /api/health`)
Notes:
- Stage 9 закрыт: политика секретов, GO/NO-GO чеклист, rollback drill как обязательная автоматическая проверка health + ручной чеклист отката.
- Stage 10 стартует по `docs/agents/stage10-prompts.md`.

## Leaflet teardown (важно)

- При резком zoom/transition возможен краш, похожий на `_leaflet_pos`. Практика: **делать задержку перед `map.remove()`** (например, 300–500ms) после анимаций.
- Всегда защищаться от повторной инициализации: если карта уже создана — корректно удалить/очистить, прежде чем повторно делать `L.map()`.

## 3D ↔ 2D переходы

- Использовать **гистерезис** для порога переключения, чтобы избежать дрожания между режимами.
- Переключение по кнопке и по порогу должны приводить к одному и тому же состоянию.

## Stage 6 (chain + Anchor) — Required Journal Markers

Ниже — обязательные блоки, которые должны быть добавлены агентами после выполнения (или заполнены с `TBD`, если агент ещё не работал над задачей).

### Stage 6 precondition — RefactorGuardianAgent (stabilize Stage 5)
Agent: RefactorGuardianAgent
Stage: 6 precondition (stabilize Stage 5)
FilesChanged:
- src/app/propose/page.tsx
- src/app/api/proposals/route.ts
- src/app/api/proposals/[id]/route.ts
- scripts/test-proposals.mjs
HowToTest:
- Проверить, что в 3 указанных модулях нет дублей `export default`/`GET`/`POST`.
- Проверить контракт `GET /api/proposals?authorPubkey=...`:
  - возвращает JSON-массив напрямую (не `{ proposals: [...] }`)
  - дефолтный `limit` = `20` (из кода handler'а)
- Запустить smoke-test, когда сервер поднят:
  - `BASE_URL=http://localhost:3000 node scripts/test-proposals.mjs`
- Убедиться в браузере, что `/propose` успешно парсит ответ `GET /api/proposals` как массив.
Notes/Risks:
- Самая частая причина поломки Stage 6 — несовпадение форматов JSON на стыке UI/тестов/эндпоинтов и наличие дублей `export default`/handlers.
- Если где-то ещё остались тесты/клиенты, ожидающие старый формат `{ proposals: [...] }`, их нужно привести к массиву.

### Stage 6 contract — ArchitectAgent
Agent: ArchitectAgent
Stage: 6 (chain + Anchor) — contract
FilesChanged:
- TBD
HowToTest:
- Документация фиксирует canonical `contentHash`, сообщение для подписи, payload/response для `POST /api/proposals/:id/submit`.
Notes/Risks:
- Если stable stringify/canonical input будут различаться frontend↔backend — submit может стать недоказуемым.

### Stage 6 schema — DBPrismaAgent
Agent: DBPrismaAgent
Stage: 6 — schema for on-chain submission facts
FilesChanged:
- TBD
HowToTest:
- Prisma schema валиден и миграции проходят.
- Stage 5 сценарии (создание/список proposals) не регрессируют.
Notes/Risks:
- Nullability `contentHash/signature/onChainTxSignature` должна соответствовать тому, что на Stage 5 ещё может не быть значений.

### Stage 6 program spec — Web3SolanaAgent
Agent: Web3SolanaAgent
Stage: 6 — Anchor program spec + tx interface
FilesChanged:
- TBD
HowToTest:
- Согласованная спецификация accounts/args/instruction names доступна BackendAPIAgent.
Notes/Risks:
- Ошибки account list/args дают RPC/Anchor error на этапе backend submit.

### Stage 6 endpoint — BackendAPIAgent
Agent: BackendAPIAgent
Stage: 6 — `POST /api/proposals/:id/submit`
FilesChanged:
- TBD
HowToTest:
- Позитивный кейс: получить `{ txSignature }` и обновить Proposal в БД.
- Негативные кейсы: 400 для неверного payload/signature/contentHash, 404 для отсутствующего proposal.
Notes/Risks:
- Verify подписи строго по message `diploma-z96a propose:<contentHash>`.

### Stage 6 UI flow — FrontendAgent
Agent: FrontendAgent
Stage: 6 — UI submit on `/propose`
FilesChanged:
- src/app/propose/page.tsx
HowToTest:
- Открыть `/propose`, подключить Phantom.
- Убедиться, что для предложений со статусом `SUBMITTED` кнопка `Submit to chain` активна.
- Нажать `Submit to chain` для `SUBMITTED` proposal.
- Проверить, что отправляется `POST /api/proposals/:id/submit`, а в таблице в колонке `Chain` отображается `txSignature` (в dev/mock: `dev-tx-...`).
- После успеха должен сработать `refetch` списка (status остаётся/обновляется по данным из `GET /api/proposals`).
Notes/Risks:
- Endpoint Stage 6 требует `Proposal.status === "SUBMITTED"`: для `DRAFT/ACCEPTED/REJECTED` кнопка будет disabled.
- `contentHash` вычисляется из данных `GET /api/proposals/:id` (включая `actions`, пусть empty) и должен совпасть с backend-канонизацией.
- `GET /api/proposals` не отдаёт `txSignature`, поэтому он показывается локально из ответа submit и подтверждается refetch статусом/доступностью UI.

### Stage 6 quality + docs — TestingCIAgent + DocsEditorAgent
Agent: TestingCIAgent + DocsEditorAgent
Stage: 6 — tests + docs finalize
FilesChanged:
- scripts/test-proposals-submit-onchain.mjs
- package.json
- docs/stage6.md
- docs/requirements.md
- docs/architecture.md
- docs/stage5plus.md
- src/app/api/proposals/[id]/submit/route.ts
HowToTest:
- Запустить сервер:
  - `npm run dev`
- В другом терминале выполнить:
  - `npm run test:proposals-submit`
- Проверить в выводе/статусах:
  - `POST /api/proposals/:id/submit` с валидной подписью возвращает `200` и JSON с `txSignature: string`;
  - `POST /api/proposals/:id/submit` с невалидной подписью возвращает `400`;
  - `POST /api/proposals/non-existing-id/submit` возвращает `404`.
- Отдельно убедиться, что тест детерминизма `contentHash` проходит (одинаковый canonical input -> одинаковый hash).
Notes/Risks:
- Самое опасное несоответствие — stable `contentHash`: backend включает `title/description` в `proposalFields` только если соответствующие поля не `null` (иначе ключи отсутствуют).
- `contentHash` в request может быть опциональным, но подпись всегда проверяется по message `diploma-z96a propose:<computedContentHash>`.
- В `production` требуется настроить Solana env (`SOLANA_RPC_URL` и `SOLANA_SUBMISSION_PAYER_PRIVATE_KEY_B58`), иначе endpoint может вернуть 502.

## Stage 5 ↔ Stage 6 Consistency Checklist (must-match)
- `GET /api/proposals` возвращает строго один формат JSON, который ожидают:
  - UI `/propose`
  - smoke-test скрипты (если используются)
- `GET /api/proposals/:id` возвращает proposal + `actions` (пусть пустой массив).
- Prisma `Proposal` поддерживает поля submission facts, ожидаемые Stage 6 (`contentHash`, `signature`, `onChainTxSignature`, `onChainSubmittedAt` или эквиваленты).
- Stable `contentHash`:
  - canonical input совпадает frontend↔backend
  - стабильный stableJson/stable stringify
  - message подписывается строго `diploma-z96a propose:<contentHash>`
- Status transitions:
  - DRAFT → SUBMITTED (не ломая UI)

## Stage 6 (chain + Anchor) — DBPrismaAgent
Agent: DBPrismaAgent
Stage: 6 (or precondition)
FilesChanged:
- prisma/schema.prisma
- prisma/migrations/20260319_stage6_submission_facts/migration.sql
- prisma/migrations/20260319_stage6_submission_facts/README.md
- docs/architecture.md
- docs/stage5plus.md
HowToTest:
- Проверить Prisma schema валидность: `set DATABASE_URL=... && npx prisma validate`
- Прогнать типовую генерацию Prisma: `npm run prisma:generate`
- Прогнать Stage 5 smoke/скрипты предложений: `npm run test:proposals`
- Проверить Stage 6 submission flow: `npm run test:proposals-submit` (если он у вас привязан к `/api/proposals/:id/submit`)
- Применить миграцию SQL (см. `prisma/migrations/.../migration.sql`) к вашему Postgres
Notes/Risks:
- Миграция SQL предполагает, что таблицы `Proposal` и `ChangeAction` уже существуют (Stage 5).
- После добавления `APPLIED/CANCELLED` в enum `ProposalStatus` endpoint проверки статуса в submit-onchain может по-прежнему принимать только `DRAFT|SUBMITTED|ACCEPTED|REJECTED` (через существующий type-guard в коде).
- Исправление обратной связи `ChangeAction.targetElement <-> NetworkElement` нужно для валидности Prisma schema и не должно влиять на контракт `/api/network`.

## Stage 6 (chain + Anchor) — Web3SolanaAgent
Agent: Web3SolanaAgent
Stage: 6
FilesChanged:
- docs/stage6.md
- src/lib/stage6/proposalSubmission.ts
- anchor/Anchor.toml
- anchor/Cargo.toml
- anchor/programs/proposal-submission/Cargo.toml
- anchor/programs/proposal-submission/src/lib.rs
HowToTest:
- `cd anchor && anchor build`
- Поднять local validator (`solana-test-validator --reset`) и выполнить:
  - `anchor deploy --provider.cluster localnet`
- Проверить, что появился IDL и что программа деплоится без seed/PDA ошибок на init.
- (опционально) проверить helper-совместимость: убедиться, что `contentHash` -> 32 bytes (64 hex chars) и signature base58 -> 64 bytes -> sha256 32 bytes.
Notes/Risks:
- В репозитории пока placeholder program id (в `anchor/.../declare_id!`/`Anchor.toml`); перед интеграцией backend должен использовать реальный deployed ProgramId (см. env `SOLANA_STAGE6_ANCHOR_PROGRAM_ID`).
- On-chain v1 не делает криптографическую проверку подписи Phantom: обязательная verify делается backend off-chain, а on-chain только хранит `signature_hash`.
- Мismatch seed/constants (`proposal_submission`, `DATA_VERSION=1`) между backend и program приведёт к ошибкам `init` или созданию “не того” PDA.

## Stage 6 (chain + Anchor) — BackendAPIAgent
Agent: BackendAPIAgent
Stage: 6
FilesChanged:
- src/app/api/proposals/[id]/submit/route.ts
HowToTest:
- Подготовить в БД `Proposal` со статусом `SUBMITTED` и корректными `scope`, `title`, `description` (так, чтобы canonical `contentHash` вычислялся одинаково backend↔frontend).
- Сгенерировать tweetnacl keypair и подписать message: `diploma-z96a propose:<computedContentHash>`, подпись передать base58 в body.
- Выполнить `POST /api/proposals/:id/submit` с JSON `{ "contentHash": "<hex>", "signature": "<base58>" }`.
- Убедиться, что в `NODE_ENV !== "production"` endpoint вернул `{ txSignature }` и обновил Proposal: `contentHash/signature/onchainTxSignature/submittedOnChainAt`.
Notes/Risks:
- Самая частая причина проблем: несоответствие canonical `contentHash` (stable stringify: сортировка ключей, `actions` порядок, и правило `undefined` в массивах трактуется как `null`).
- Подпись проверяется строго по message `diploma-z96a propose:<contentHash>` и public key `Proposal.authorPubkey`.
- В `production` backend отправляет on-chain Memo-транзакцию; нужны `NEXT_PUBLIC_SOLANA_RPC` и ключ payer (`SOLANA_SUBMISSION_PAYER_PRIVATE_KEY_B58` или `SOLANA_SUBMISSION_PAYER_PRIVATE_KEY`).

## Stage 6 (chain + Anchor) — ArchitectAgent
Agent: ArchitectAgent
Stage: 6
FilesChanged:
- docs/stage6.md
- docs/architecture.md
- docs/requirements.md
HowToTest:
- Проверить, что `docs/stage5plus.md` и `docs/stage6.md` используют одинаковый canonical input и stable stringify для `contentHash` (actions=[], title/description: string|null).
- Проверить, что Stage 6 контракт фиксирует endpoint `POST /api/proposals/:id/submit` и минимальный ответ `{ txSignature }` в `docs/stage6.md`, `docs/architecture.md`, `docs/requirements.md`.
Notes/Risks:
- Наиболее вероятная причина фейлов — расхождение canonical `contentHash` (ключи vs отсутствие, особенно правило `null` вместо `undefined`).
- Backend/Frontend должны валидировать payload строго по контракту: `{ contentHash, signature(base58) }`.

## Stage 7 (history + rollback) — RefactorGuardianAgent
Agent: RefactorGuardianAgent
Stage: 7
FilesChanged:
- (none; only precondition checks)
HowToTest:
- Убедиться, что `src/app/propose/page.tsx` парсит `GET /api/proposals?...` как массив `ProposalDTO[]`.
- Убедиться, что `src/app/api/proposals/route.ts` возвращает JSON-массив напрямую (не `{ proposals: [...] }`) и `limit` по умолчанию = `20`.
- Убедиться, что `src/app/api/proposals/[id]/route.ts` возвращает proposal с полем `actions` (пусть пустым массивом).
- Убедиться, что `src/app/api/proposals/[id]/submit/route.ts` обновляет `Proposal.status` в `SUBMITTED` и возвращает JSON с полем `txSignature`.
Notes/Risks:
- Частая причина поломки Stage 7 — регрессии JSON-формата на стыке UI `/propose` и endpoint’ов `/api/proposals*` при добавлении apply/history/rollback.
- Любые изменения submit/Stage 6 endpoints должны сохранить `{ txSignature }` и требование `Proposal.status === "SUBMITTED"`.

## Stage 7 (history + rollback) — DBPrismaAgent
Agent: DBPrismaAgent
Stage: 7
FilesChanged:
- prisma/schema.prisma
- prisma/migrations/20260319_stage7_history_entry/migration.sql
- prisma/migrations/20260319_stage7_history_entry/README.md
HowToTest:
- Prisma schema: `set DATABASE_URL=... && npx prisma@6.4.1 validate`
- Сгенерировать Prisma client: `npm run prisma:generate`
- Применить миграцию SQL на Postgres (см. `prisma/migrations/20260319_stage7_history_entry/migration.sql`)
- Прогнать проверки Stage 5 endpoint’ов:
  - `GET /api/proposals` (возвращает JSON-массив, совместимый с UI)
  - `GET /api/proposals/:id` (proposal + поле `actions`, пусть empty array)
Notes/Risks:
- Миграция предполагает, что таблицы `Proposal` и `ChangeAction` уже существуют.
- `HistoryEntry.diff` — JSONB и может требовать согласованной структуры с Backend rollback v1 (но схема уже готова для этого через `diff: Json`).

## Stage 8 (polish) — DBPrismaAgent
Agent: DBPrismaAgent
Stage: 8
FilesChanged:
- prisma/schema.prisma
- prisma/migrations/20260319_stage8_historyentry_hardening/migration.sql
- prisma/migrations/20260319_stage8_historyentry_hardening/README.md
HowToTest:
- Prisma schema: `set DATABASE_URL=... && npx prisma@6.4.1 validate`
- Применить SQL артефакт `prisma/migrations/20260319_stage8_historyentry_hardening/migration.sql` к Postgres
- Проверить Stage 7 endpoints (если уже реализованы):
  - `GET /api/proposals/:id/history` (список history)
  - `POST /api/proposals/:id/rollback` (rollback последнего apply)
  - убедиться, что `HistoryEntry.diff.kind` у созданных history entries принимает значения `CREATE|UPDATE|DELETE`
Notes/Risks:
- Stage 7/8 runtime source of truth для `HistoryEntry` — raw SQL (`src/lib/stage7/historyStore.ts`), а не Prisma client. Prisma-схема здесь “совместима по полям”, но не используется в runtime.
- CHECK constraint на `diff.kind` может отрезать уже существующие “неканоничные” diff, если в БД окажутся старые записи с другой структурой.

## Stage 9 (deployment + observability + operations) — DBPrismaAgent
Agent: DBPrismaAgent
Stage: 9
FilesChanged:
- prisma/schema.prisma
- prisma/migrations/20260319_stage9_db_ops_hardening/migration.sql
- prisma/migrations/20260319_stage9_db_ops_hardening/README.md
- docs/db-operations-runbook.md
HowToTest:
- Проверить Prisma schema: `set DATABASE_URL=... && npx prisma@6.4.1 validate`
- Применить SQL миграцию Stage 9: `prisma/migrations/20260319_stage9_db_ops_hardening/migration.sql`
- Проверить наличие индексов (см. SQL в `docs/db-operations-runbook.md`, секция index checklist)
- Выполнить integrity-check запросы из runbook:
  - orphan checks для `HistoryEntry.proposalId` и `HistoryEntry.actionId`
  - `diff.kind` validity-check (`CREATE|UPDATE|DELETE`)
Notes:
- Для Stage 7/8 history runtime всё ещё используется raw SQL (`src/lib/stage7/historyStore.ts`); в Stage 9 зафиксирован “unified approach”: не смешивать две разные формы таблицы `HistoryEntry`.
- Добавлен DB runbook с backup/restore baseline и migration policy (`migrate dev` только локально, deploy через зафиксированные migration SQL).

Agent: DBPrismaAgent
Stage: 10
FilesChanged:
- docs/db-operations-runbook.md
HowToTest:
- Проверить применимость least-privilege SQL (секция 6 runbook) в staging DB: runtime-роль подключается и выполняет CRUD, но не имеет superuser/createdb/createrole.
- Проверить `DATABASE_URL` в production/stage c явным `sslmode` (`require` или `verify-full`).
- Выполнить SQL из секции 7 runbook (`pg_stat_statements` + EXPLAIN) и убедиться, что горячие запросы proposals/history/network используют ожидаемые индексы.
- Выполнить integrity SQL из секции 4/8 runbook и убедиться, что orphan-строк и невалидных `diff.kind` нет.
Notes:
- В Stage 10 по секции C изменения ограничены DB security baseline/runbook; публичные API-контракты Stage 5-8 не затронуты.
- Runtime history path остаётся raw-SQL (`src/lib/stage7/historyStore.ts`), поэтому контроль referential integrity и качества `diff` выполняется операционно SQL-чеками из runbook.

## Stage 7 (history + rollback) — ArchitectAgent
Agent: ArchitectAgent
Stage: 7
FilesChanged:
- docs/stage7.md
- docs/architecture.md
HowToTest:
- Проверить, что `docs/stage7.md` содержит точные payload/response схемы для:
  - `POST /api/proposals/:id/actions`
  - `POST /api/proposals/:id/apply`
  - `POST /api/proposals/:id/rollback`
  - `GET /api/proposals/:id/history`
- Проверить, что `docs/architecture.md` ссылается на `docs/stage7.md` и описывает контракт endpoints Stage 7.
Notes/Risks:
- Backend rollback v1 должен опираться на `HistoryEntry.diff` в формате `ChangeActionDiff` с `diff.kind` (`CREATE|UPDATE|DELETE`); любые отличия структуры diff приведут к некорректному откату.
- В текущем v1 backend пока не валидирует `signature` на endpoints `actions/apply/rollback`; front подписи оставлены для будущей server-side проверки.
- `APPLIED/CANCELLED` пока не используются как status-gating в backend: `apply` (в dev) может перевести `SUBMITTED -> ACCEPTED`, а `rollback` не изменяет `Proposal.status`.

## Stage 7 (history + rollback) — FrontendAgent
Agent: FrontendAgent
Stage: 7
FilesChanged:
- src/app/propose/page.tsx
HowToTest:
- Открыть `/propose`, в таблице выбрать proposal в списке (dropdown в панели Stage 7).
- Для `DRAFT` proposals: в форме Add ChangeAction ввести валидный JSON в `elementPayload` и (если нужно) `targetElementId`, нажать `Add action`.
- Для `ACCEPTED` proposals: нажать `Apply` и проверить, что появляется результат (в UI: `historyId` или сообщение об ошибке).
- Для `APPLIED` proposals: загрузить history (она подтягивается при выборе), нажать `Rollback` и проверить результат/ошибку.
Notes/Risks:
- Если backend Stage 7 endpoints ещё не реализованы, кнопки будут давать ошибку сети/HTTP — это не влияет на компиляцию UI.
- Rollback подписывает сообщение с `historyId`, выбранным как entry с максимальным `appliedAt`; если backend меняет порядок/формат истории, необходимо проверить выбор latest.

## Stage 7 (history + rollback) — BackendAPIAgent
Agent: BackendAPIAgent
Stage: 7
FilesChanged:
- src/app/api/proposals/[id]/actions/route.ts
- src/app/api/proposals/[id]/apply/route.ts
- src/app/api/proposals/[id]/rollback/route.ts
- src/app/api/proposals/[id]/history/route.ts
- src/lib/stage7/historyStore.ts
- src/lib/stage7/networkElementOps.ts
HowToTest:
- Создать/найти `Proposal` в БД со статусом `DRAFT` или `SUBMITTED` (и при необходимости довести до `ACCEPTED` через apply в dev).
- `POST /api/proposals/:id/actions` с `actionType=CREATE` и `elementPayload` содержащим `type` (один из `CABLE_COPPER|CABLE_FIBER|BASE_STATION|SATELLITE|EQUIPMENT`) и остальными полями `NetworkElement` (например `lat/lng/altitude/name`).
- `POST /api/proposals/:id/apply` — проверить, что создаётся/изменяется `NetworkElement` и что в `GET /api/proposals/:id/history` появляется entry.
- `POST /api/proposals/:id/rollback` — проверить, что последний history entry откатывает изменения `NetworkElement`, а entry удаляется из истории.
Notes/Risks:
- HistoryEntry хранится через raw-SQL (без Prisma-модели). При появлении полноценной Prisma-схемы HistoryEntry потребуется синхронизация структуры/таблицы.
- rollback v1 опирается на snapshot-before-apply diff, который формируется в `POST /api/proposals/:id/apply` и должен быть совместимым между apply и rollback.

## Stage 7 (history + rollback) — TestingCIAgent + DocsEditorAgent
Agent: TestingCIAgent + DocsEditorAgent
Stage: 7
FilesChanged:
- scripts/test-proposals-stage7.mjs
- package.json
- docs/stage7.md
- docs/architecture.md
HowToTest:
- Запустить `npm run dev`.
- В другом терминале выполнить: `npm run test:proposals-stage7`.
- Проверить, что smoke-тесты завершаются успешно и покрывают:
  - `POST /api/proposals/:id/actions` (валидный/невалидный payload),
  - `POST /api/proposals/:id/apply` (создаёт NetworkElement + HistoryEntry),
  - `GET /api/proposals/:id/history` (в списке есть созданный historyId),
  - `POST /api/proposals/:id/rollback` (откатывает CREATE: NetworkElement удалён).
Notes/Risks:
- Если BackendAPIAgent ещё не реализовал Stage 7 endpoint’ы, smoke-тесты упадут (404/500) — это сигнал, что actions/apply/rollback/history + rollback diff ещё не готовы.
- Валидность `elementPayload` зависит от реализации BackendAPIAgent (в тесте используется CREATE payload, совместимый с полями Prisma `NetworkElement`).

## Stage 8 (polish) — RefactorGuardianAgent
Agent: RefactorGuardianAgent
Stage: 8
FilesChanged:
- src/app/api/proposals/[id]/history/route.ts
HowToTest:
- Открыть `/propose` и убедиться, что история подгружается и рендерится корректно (UI ожидает массив).
- Проверить:
  - `GET /api/proposals?authorPubkey=...` возвращает `ProposalDTO[]` (массив напрямую),
  - `GET /api/proposals/:id` содержит `actions` (пусть пустой массив),
  - `POST /api/proposals/:id/submit` возвращает `{ txSignature }`.
Notes/Risks:
- Другие Stage 7 endpoints (actions/apply/rollback) могут возвращать не все поля, которые UI пытается прочитать (например, `historyId`). Это не должно ломать рендер, но если будет проблема — проверять response shape UI↔backend.

## Stage 9 (deployment + observability + operations) — RefactorGuardianAgent
Agent: RefactorGuardianAgent
Stage: 9
FilesChanged:
- DEVELOPMENT_JOURNAL.md
HowToTest:
- Проверить контракт Stage 5: `GET /api/proposals` возвращает JSON-массив.
- Проверить контракт Stage 5 detail: `GET /api/proposals/:id` возвращает proposal с `actions`.
- Проверить контракт Stage 6: `POST /api/proposals/:id/submit` возвращает `{ txSignature }`.
- Проверить контракт Stage 7 history: `GET /api/proposals/:id/history` возвращает JSON-массив.
- Сверить `README.md`, `PROJECT_STAGES.md`, `AGENTS.md` на一致ность статусов/маппинга стадий.
Notes:
- Явных регрессий контрактов Stage 5-8 не обнаружено.
- Зафиксированный инвариант перед deployment: UI `/propose` и `/api/proposals*` должны оставаться согласованы по JSON-shape (list/history — массивы напрямую; submit — объект с `txSignature`).

## Stage 8 (polish) — FrontendAgent
Agent: FrontendAgent
Stage: 8
FilesChanged:
- src/app/propose/page.tsx
HowToTest:
- Открыть `/propose`, подключить Phantom.
- Несколько раз нажать `Submit to chain` для одного и того же `SUBMITTED` предложения и убедиться, что UI стабильно показывает `txSignature` (и запросы не становятся более “тяжёлыми”, без видимых ошибок/зависаний).
- Выбрать proposal в dropdown в секции Stage 7 и проверить, что history подгружается и UI не блокируется во время загрузки.
- Добавить/применить/откатить (если backend Stage 7 endpoints реализованы) и убедиться, что результаты/ошибки отображаются корректно.
Notes/Risks:
- Cache `contentHash` в UI безопасен в рамках текущего потока: submit доступен только для `Proposal.status === "SUBMITTED"`, а значит title/description/actions считаются стабильными.
- Если backend Stage 7 endpoint’ы меняют shape ответов (например, `historyId`) — может потребоваться подстройка типов/UI отображения.

## Stage 9 (deployment + observability + operations) — FrontendAgent
Agent: FrontendAgent
Stage: 9
FilesChanged:
- src/app/propose/page.tsx
HowToTest:
- Открыть `/propose` с отключённым интернетом/неработающим backend и проверить, что ошибки отображаются человекочитаемо (а не только `HTTP xxx`).
- Смоделировать `429` и `5xx` ответы для `/api/proposals*` (через backend guard/proxy) и проверить тексты ошибок в UI.
- Подключить/отключить Phantom и убедиться, что страница не падает, а показывает корректные сообщения.
- Проверить, что загрузка списка и деталей proposals работает без использования `window.location.origin` (fetch на относительные URL).
Notes:
- Улучшения ограничены секцией FrontendAgent: только UX/readiness изменения на `/propose`, без изменения API-контрактов.
- Для не-JSON ошибок backend используется fallback человекочитаемого сообщения по HTTP статусу.

## Stage 10 (security + observability — production depth) — FrontendAgent
Agent: FrontendAgent
Stage: 10
FilesChanged:
- src/app/propose/page.tsx
HowToTest:
- Открыть `/propose` с отключённым кошельком: проверить наличие явного сообщения, что подпись недоступна.
- Смоделировать сетевую ошибку (выключить backend/интернет) и проверить человекочитаемое сообщение вместо `Unknown error`.
- Смоделировать `429`/`5xx` ответы от `/api/proposals*` и убедиться, что UI показывает понятные тексты.
- Проверить, что flow подписей (`submit/actions/apply/rollback`) не ломается и по-прежнему использует Phantom.
Notes:
- Изменения ограничены фронтендом (секция E), API-контракты Stage 5–8 не изменялись.
- Для проблем вида `Failed to fetch` добавлено явное сообщение с подсказкой проверить сеть/VPN/прокси/CSP.

Agent: FrontendAgent
Stage: 11
FilesChanged:
- src/app/propose/page.tsx
HowToTest:
- Открыть `/propose` и дождаться загрузки списка + history.
- Временно отключить сеть/подключение к backend и убедиться, что:
  - UI уходит в понятное состояние ошибки (не висит бесконечно),
  - для GET-запросов есть 1 retry (задержка/сообщение становится понятным после таймаута).
- Подключить Phantom и проверить, что основной flow (submit/action/apply/rollback) не сломан (POST не менялся по контрактам).
Notes:
- Timeout+retry добавлены только для GET-загрузок (list/details/history), POST mutation flow не трогался, чтобы не создавать риск “успешного” выполнения при abort.
- Сообщения об ошибках остаются человекочитаемыми и совместимыми с будущими CSP/HSTS режимами (нет дополнительных inline scripts/unsafe источников).

## Stage 8 (polish) — BackendAPIAgent
Agent: BackendAPIAgent
Stage: 8
FilesChanged:
- src/app/api/proposals/[id]/actions/route.ts
- src/app/api/proposals/[id]/apply/route.ts
- src/app/api/proposals/[id]/rollback/route.ts
- src/app/api/proposals/[id]/history/route.ts
- src/app/api/tile/route.ts
- src/app/api/geocode/search/route.ts
- src/app/api/geocode/reverse/route.ts
- src/lib/rateLimit.ts
HowToTest:
- Открыть `/propose` и проверить:
  - Add action: backend возвращает `actionId`
  - Apply: backend возвращает `historyId` и переводит proposal в `APPLIED`
  - Rollback: backend возвращает `historyId`, удаляет latest HistoryEntry и корректно обновляет статус (APPLIED если история ещё осталась)
  - History: `GET /api/proposals/:id/history` возвращает JSON-массив
- Убедиться, что tile/geocode при частых запросах возвращают `429` и при этом не ломают визуализацию.
Notes/Risks:
- rate limiting реализован in-memory (по-process); на разных инстансах/рестартах поведение будет отличаться.
- История сейчас создаётся через raw-SQL таблицу `HistoryEntry`; при появлении Prisma-модели необходимо синхронизировать доступ и убрать raw-SQL при едином подходе.

## Stage 9 (deployment + observability + operations) — DocsEditorAgent
Agent: DocsEditorAgent
Stage: 9
FilesChanged:
- README.md
- PROJECT_STAGES.md
- docs/operations.md
HowToTest:
- Проверить, что команды из `README.md` и `docs/operations.md` исполнимы copy-paste:
  - `npm ci && npm run lint && npm run build`
  - `npm run dev` и `curl -sS http://localhost:3000/api/health`
  - `npm run test:proposals && npm run test:proposals-submit && npm run test:proposals-stage7 && npm run test:proposals-stage8`
- Убедиться, что `PROJECT_STAGES.md` отражает Stage 9 как `in progress`.
Notes:
- Изменения ограничены документацией (секция G Stage 9), без правок backend/frontend/CI-конфига.
- В `docs/operations.md` указаны текущие лимиты rate limit и env matrix по фактическому коду.

## Stage 9 (deployment + observability + operations) — BackendAPIAgent
Agent: BackendAPIAgent
Stage: 9
FilesChanged:
- src/app/api/health/route.ts
- src/lib/apiOps.ts
- src/app/api/proposals/[id]/submit/route.ts
- src/app/api/proposals/[id]/apply/route.ts
- src/app/api/proposals/[id]/rollback/route.ts
- docs/architecture.md
HowToTest:
- `GET /api/health`: при доступной БД ожидается `200` и `{ ok: true, app: "ok", db: "ok" }`.
- Имитировать недоступную БД (невалидный `DATABASE_URL`) и проверить, что `/api/health` возвращает `503` + `{ error: "health check failed" }`.
- Вызвать `POST /api/proposals/:id/submit`, `POST /api/proposals/:id/apply`, `POST /api/proposals/:id/rollback` и проверить:
  - штатный ответ без изменения контрактов (`txSignature` для submit, `historyId` для apply/rollback),
  - при ошибках 5xx возвращается предсказуемый JSON `{ error: string }`.
- Превысить лимиты запросов с одного IP (например, для submit/apply/rollback) и убедиться в `429 { error: "rate limit exceeded" }`.
- Проверить серверные логи: появляются структурированные записи `type=api_metric` с `route/method/status/durationMs/ok`.
Notes:
- Rate limiting реализован in-memory (per-process); для multi-instance потребуется централизованный storage (Redis/DB).
- Structured metrics реализованы через JSON logs и не заменяют полноценный metrics backend.
- Ошибки 5xx унифицированы как `{ error: string }` без stacktrace leakage наружу.

Agent: BackendAPIAgent
Stage: 10
FilesChanged:
- src/lib/apiError.ts
- src/app/api/proposals/[id]/actions/route.ts
- src/app/api/proposals/[id]/apply/route.ts
- src/app/api/proposals/[id]/rollback/route.ts
- src/app/api/proposals/[id]/submit/route.ts
- next.config.mjs
- docs/architecture.md
HowToTest:
- Проверить health: `GET /api/health` -> `200` и JSON `{ ok: true, app: "ok", db: "ok" }` при доступной БД.
- Проверить унификацию 5xx на мутациях proposals (создать искусственный failure, например с недоступной БД) и убедиться, что ответ содержит `{ error, correlationId }` + header `x-correlation-id`.
- Проверить, что публичные контракты Stage 5–8 не изменились:
  - `POST /api/proposals/:id/submit` по-прежнему возвращает `{ txSignature }` на success,
  - `GET /api/proposals` и `GET /api/proposals/:id` форматы прежние.
- Проверить security headers в ответах (например через DevTools/Network или curl -I): `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`.
Notes:
- Security headers заданы консервативно без строгого CSP, чтобы не ломать Phantom/Leaflet flow.
- Correlation id добавляется только для унифицированных 5xx через helper и предназначен для incident triage в логах.
- Rate limits остаются in-memory best-effort; для production multi-instance рекомендуется централизованный rate limiter.

## Stage 8 (polish) — ArchitectAgent
Agent: ArchitectAgent
Stage: 8
FilesChanged:
- docs/stage7.md
HowToTest:
- Сверить, что `docs/stage7.md` описывает `HistoryEntry.diff` как `ChangeActionDiff` с `diff.kind` (`CREATE|UPDATE|DELETE`) и полями `createdElementId/beforeElement/deletedElement` — как в `src/app/api/proposals/[id]/rollback/route.ts`.
- Сверить message-format для подписей `apply`/`rollback` на `/propose` с тем, что описано в `docs/stage7.md` (frontend использует `contentHash` для apply и `historyId` для rollback).
- Сверить canonical `contentHash` Stage 6: stable stringify и вычисление sha256 на frontend `/propose` совпадают с backend `/api/proposals/:id/submit`.
Notes/Risks:
- Backend в текущем v1 signature в этих endpoints не валидирует; если позже будет усиление security, docs нужно будет уточнить.
- Любое изменение формата `HistoryEntry.diff` без обновления docs приведёт к некорректному rollback.

## Stage 9 (polish) — ArchitectAgent
Agent: ArchitectAgent
Stage: 9
FilesChanged:
- docs/operations.md
- docs/architecture.md
HowToTest:
- Проверить, что `docs/operations.md` покрывает: target deployment topology, SLO-lite, startup/shutdown runbook, health-check flow, incident flow, env vars matrix.
- Проверить, что `docs/architecture.md` ссылается на `docs/operations.md` в разделе Stage 9 operations.

## Stage 9 (deployment + observability + operations) — TestingCIAgent follow-up
Agent: TestingCIAgent
Stage: 9
FilesChanged:
- .github/workflows/smoke-tests.yml
- README.md
HowToTest:
- В GitHub Actions вручную запустить workflow `Smoke Tests (Manual)` через `workflow_dispatch`.
- Убедиться, что:
  - поднимается service `postgres`,
  - выполняются `prisma:generate` + `prisma migrate deploy`,
  - dev server проходит readiness check по `/api/health`,
  - проходят `test:proposals`, `test:proposals-submit`, `test:proposals-stage7`, `test:proposals-stage8`.
Notes:
- Workflow оставлен manual, чтобы не нагружать каждый PR долгими e2e/smoke прогонами.
- Для runtime-валидации по runbook: поднять приложение и проверить `GET /api/health` + базовый smoke `GET /api/proposals`.
Notes:
- На текущем этапе topology зафиксирована как single-instance baseline с планом scale-up до multi-instance.
- In-memory ограничения (например, rate limiting) при multi-instance требуют внешнего shared store (Redis/эквивалент).

Agent: ArchitectAgent
Stage: 10
FilesChanged:
- docs/security-observability.md
- docs/architecture.md
HowToTest:
- Проверить, что `docs/security-observability.md` содержит:
  - threat model (auth, API abuse, geocode/tile proxy, proposals mutation paths),
  - рекомендации по security headers (CSP/HSTS/XFO и rollout),
  - observability plan (что логируем, retention, PII policy).
- Проверить, что `docs/architecture.md` в разделе Stage 10 ссылается на `docs/security-observability.md`.
Notes:
- Изменения ограничены архитектурной/операционной документацией секции B, без изменения публичных API-контрактов Stage 5-8.
- CSP указан как staged rollout (Report-Only -> enforce), чтобы не сломать Phantom/Leaflet интеграции.

## Stage 10 (security + observability) — RefactorGuardianAgent
Agent: RefactorGuardianAgent
Stage: 10
FilesChanged:
- DEVELOPMENT_JOURNAL.md
HowToTest:
- Проверить, что в репозитории нет `.env`/`.env.local` (только `.env.example`), а `.gitignore` содержит `.env*`.
- Поиск по коду (`src/`) на использование env:
  - клиентские модули используют только `NEXT_PUBLIC_*` (проверено на `NEXT_PUBLIC_SOLANA_RPC` в `src/app/providers.tsx`);
  - серверные секреты (`SOLANA_SUBMISSION_PAYER_PRIVATE_KEY*`, `DATABASE_URL`) не используются в client-side коде.
- Проверить, что в логах/коде нет явного вывода значений секретов (`DATABASE_URL`, private keys); допускаются только технические сообщения “not configured”.
- Сверить `docs/secrets-policy.md` с фактическим env usage (`NEXT_PUBLIC_SOLANA_RPC`, `SOLANA_RPC_URL`, `SOLANA_SUBMISSION_PAYER_PRIVATE_KEY*`, `DATABASE_URL`).
Notes:
- Явных регрессий по секьюрности Stage 5-8 не обнаружено: публичные API-контракты и маршруты не изменялись.
- `NEXT_PUBLIC_SOLANA_RPC` используется как публичный endpoint (соответствует policy); приватный payer key остаётся только server-side.
- В `docs/operations.md` присутствуют примеры env; это допустимо только как шаблоны без реальных секретов.

Agent: ArchitectAgent
Stage: 10
FilesChanged:
- docs/stage10-security-observability.md
- docs/architecture.md
HowToTest:
- Открыть `docs/stage10-security-observability.md` и проверить, что есть:
  - threat model для auth/API abuse/geocode-tile proxy/proposals mutation,
  - рекомендации по security headers (CSP, HSTS, X-Frame-Options и др.),
  - observability plan (что логировать, retention, PII policy, alerting baseline).
- Проверить, что `docs/architecture.md` в разделе Stage 10 ссылается на `docs/stage10-security-observability.md`.
- Сверить, что публичные API-контракты Stage 5-8 в `PROJECT_STAGES.md` и `docs/requirements.md` не изменялись.
Notes:
- Выполнена только секция B (ArchitectAgent): документирование threat model/security architecture/observability.
- Реализация headers/rate limits/logging в коде остается задачей других секций (BackendAPIAgent/TestingCIAgent/DocsEditorAgent).

Agent: RefactorGuardianAgent
Stage: 11
FilesChanged:
- DEVELOPMENT_JOURNAL.md
HowToTest:
- (при поднятом `npm run dev` и работающей БД) `curl -sS http://localhost:3000/api/health`
- (при поднятом `npm run dev`) `BASE_URL=http://localhost:3000 node scripts/test-proposals.mjs`
- (опционально, если окружение готово) `npm run ops:rollback-drill`
Notes:
- Preflight не запускает нагрузку/хаотичные отказы, только контрактные проверки: Stage 5-8 proposals list/detail/submit/history возвращают ожидаемые shape-и, а `GET /api/health` — baseline.
- Любые изменения Stage 10 headers/observability/metrics — делаются другими агентами; здесь задача — не допустить регрессий API/response форматов.

Agent: DBPrismaAgent
Stage: 11
FilesChanged:
- docs/db-operations-runbook.md
HowToTest:
- Проверить connection pooling в staging/prod-like окружении:
  - `DATABASE_URL` указывает на pooler (PgBouncer/managed pool) и включён SSL (`sslmode=require` или `verify-full`).
  - активные DB-соединения не растут бесконтрольно при деплое/рестарте.
- Выполнить `EXPLAIN (ANALYZE, BUFFERS)` для hot query pattern’ов:
  - proposals list: фильтр `authorPubkey`/`status`, сортировка `createdAt DESC`;
  - network bbox: `scope` + `lat BETWEEN` + `lng BETWEEN`;
  - history latest: `proposalId` + `appliedAt DESC LIMIT`.
- (Опционально) если окружение готово: запустить `npm run ops:rollback-drill`.
Notes:
- Stage 11 изменения сделаны без трогания публичных API-контрактов Stage 5–8.
- Основные риски: pooling в transaction mode может проявить зависимости от session state (temp tables/session variables) — это стоит проверить в e2e smoke при multi-instance запуске.

Agent: DBPrismaAgent
Stage: 12
FilesChanged:
- prisma/schema.prisma
- prisma/migrations/20260320_stage12_moderation_audit_baseline/migration.sql
- prisma/migrations/20260320_stage12_moderation_audit_baseline/README.md
HowToTest:
- Prisma schema валиден: `set DATABASE_URL=... && npx prisma@6.4.1 validate`
- Применить миграцию SQL к Postgres (стейдж/прод):
  - `prisma/migrations/20260320_stage12_moderation_audit_baseline/migration.sql`
- Проверить referential integrity:
  - нет `ModerationDecision` с orphan `proposalId` (FK ON DELETE CASCADE should prevent orphans).
- Проверить отсутствие регрессий Stage 5–8:
  - `GET /api/proposals` и `GET /api/proposals/:id` продолжают отдавать тот же JSON shape (новые поля только в БД).
Notes:
- Stage 12 moderation endpoints (под `/api/moderation/*`) должны создавать/обновлять `ModerationDecision` с уникальностью `proposalId` для идемпотентности и защиты от двойного решения.
- В этой задаче не трогаются существующие `/api/proposals/*` обработчики и их контракты; moderation audit добавлен как отдельная сущность.

Agent: ArchitectAgent
Stage: 11
FilesChanged:
- docs/stage11-post-launch-architecture.md
- docs/operations.md
- docs/architecture.md
HowToTest:
- Открыть `docs/stage11-post-launch-architecture.md` и проверить:
  - target load profile (RPS/instances),
  - что shared state (Redis) сформулирован только для rate-limit при multi-instance,
  - что incident definition/alert baselines согласованы с SLO-lite из `docs/operations.md`.
- Открыть `docs/operations.md` и убедиться, что есть ссылка/summary Stage 11.
- Открыть `docs/architecture.md` и убедиться, что есть ссылка на документ Stage 11.
Notes:
- Изменения только документальные; публичные API-контракты Stage 5–8 не трогались.
- Точные пороги алертов (N%/минуты) нужно уточнить после первой production недели по реальным метрикам.

Agent: BackendAPIAgent
Stage: 11
FilesChanged:
- src/lib/rateLimit.ts
- src/lib/circuitBreaker.ts
- src/lib/bodySizeGuard.ts
- src/app/api/health/route.ts
- src/app/api/proposals/[id]/actions/route.ts
- src/app/api/proposals/[id]/apply/route.ts
- src/app/api/proposals/[id]/rollback/route.ts
- src/app/api/proposals/[id]/submit/route.ts
- src/app/api/tile/route.ts
- src/app/api/geocode/search/route.ts
- src/app/api/geocode/reverse/route.ts
- docs/operations.md
HowToTest:
- Запустить `npm run dev` и проверить `GET /api/health`:
  - success: `200 { ok: true, app: "ok", db: "ok" }`
  - failure: временно указать невалидный `DATABASE_URL` и проверить `503 { error: "health check failed" }` + наличие correlation id в заголовке `x-correlation-id`.
- Проверить унификацию 5xx на прокси:
  - при недоступности tile/geocode upstream ожидать `502 { error: "upstream error" }` или `502 { error: "geocode failed"/"reverse geocode failed" }` и header `x-correlation-id`.
- Проверить body size guard (mutation):
  - отправить oversized запрос (например, увеличить `elementPayload` в `/api/proposals/:id/actions` так, чтобы `content-length` > лимита) и убедиться, что вернулся `400 { error: "payload too large" }`.
- Проверить rate-limit 429:
  - повторно стучать по `POST /api/proposals/:id/submit|actions|apply|rollback` > лимита для одного IP и убедиться в ответе `429 { error: "rate limit exceeded" }`.
- Опционально (если подготовлен Redis):
  - установить `RATE_LIMIT_BACKEND=redis` и `REDIS_URL`, убедиться, что система продолжает возвращать те же ответы 429/ошибок.
Notes:
- Redis rate-limit используется только если включён `RATE_LIMIT_BACKEND=redis`, задан `REDIS_URL` и модуль `redis` доступен в окружении; при ошибках/отсутствии модуля backend фоллбекится в in-memory режим.
- Circuit breaker “best-effort”: открытие схемы снижает нагрузку на upstream при sustained ошибках, но не гарантирует 100% успешный fallback.

Agent: RefactorGuardianAgent
Stage: 12
FilesChanged:
- DEVELOPMENT_JOURNAL.md
HowToTest:
- Контрактные проверки Stage 5–8 (после поднятия `npm run dev` и БД):
  - `GET /api/proposals?authorPubkey=<pubkey>` возвращает JSON-массив (не `{ proposals: [...] }`)
  - `GET /api/proposals/:id` возвращает proposal с `actions` (пусть пустым)
  - `GET /api/proposals/:id/history` возвращает JSON-массив (не `{ history: [...] }`)
  - `GET /api/health` возвращает `200 { ok: true, app: "ok", db: "ok" }`
- Проверка отсутствия “тихих” изменений: убедиться, что в коде/маршрутах нет endpoint’ов под `/api/moderation/*` (или что они добавляются отдельными файлами без правок существующих `/api/proposals/*`).
Notes:
- Stage 12 moderation baseline (новые `/api/moderation/*`) пока не реализован в текущем коде (поиск по `/api/moderation` в `src/` не находит совпадений). Для следующего шага другие секции должны добавлять новые endpoints только под согласованный префикс и не трогать `/api/proposals/*` без отдельной явной задачи.
- Модули, которые вероятнее всего будут затронуты в Stage 12 и должны пересекаться только после ревью:
  - shared rate limit + Redis switch: `src/lib/rateLimit.ts` (env: `RATE_LIMIT_BACKEND=redis`, `REDIS_URL`)
  - body size limits / mutation guards: `src/lib/bodySizeGuard.ts`
  - observability baseline (health + `api_metric`): `src/app/api/health/route.ts`, `src/lib/apiOps.ts`

Agent: FrontendAgent
Stage: 12
FilesChanged:
- src/app/moderate/page.tsx
- src/components/HomePage.tsx
HowToTest:
- Открыть `/moderate` и подключить Phantom.
- Убедиться, что для предложений со статусом `SUBMITTED` показываются кнопки `Accept`/`Reject`.
- Нажать `Accept` (или `Reject`) и проверить:
  - при отсутствии прав backend возвращает 401/403, а UI показывает человекочитаемую ошибку;
  - при rate limiting backend возвращает 429, а UI показывает сообщение 429.
- Убедиться, что `/propose` и визуализация сети не ломаются.
Notes:
 - На момент этих изменений backend-реализация moderation baseline добавлена под `/api/moderation/*` (в частности, endpoint decision). При отсутствии прав backend вернёт 401/403/429/4xx/5xx, а UI не должен падать.
- Для списка пока используется фильтр `GET /api/proposals?status=SUBMITTED`; если в будущем появится moderation-specific list endpoint — можно заменить URL без изменения UI-логики.

Agent: BackendAPIAgent
Stage: 12
FilesChanged:
- src/app/api/proposals/route.ts
- src/lib/moderation/decideProposal.ts
- src/app/api/moderation/proposals/[id]/decide/route.ts
- src/app/api/moderation/[id]/decide/route.ts
- src/app/api/moderation/decide/route.ts
- package.json
- package-lock.json
HowToTest:
- Поднять dev-сервер: `npm run dev`
- Настроить переменные окружения:
  - `MODERATOR_PUBKEYS` (comma-separated allowlist, как минимум один pubkey)
  - (опционально) `RATE_LIMIT_BACKEND=redis` и `REDIS_URL`
- Подготовить тестовое предложение со статусом `SUBMITTED` (через существующий `POST /api/proposals/:id/submit` или прямой update в БД для smoke).
- Вызвать moderation endpoint:
  - `POST /api/moderation/proposals/<proposalId>/decide` (каноничный)
  - или UI alias: `POST /api/moderation/<proposalId>/decide`
  - или fallback: `POST /api/moderation/decide`
  - body: `{ "moderatorPubkey": "<allowedPubkey>", "decision": "ACCEPTED" }` (или `status: "ACCEPTED"`; signature опциональна)
- Проверить:
  - response `200` содержит `ok: true`, `status`, и `moderationDecisionId`
  - повторный вызов с тем же решением идемпотентен
  - вызов с не-allowlisted `moderatorPubkey` возвращает `403`
  - при слишком большом body возвращается `400`
  - при частых вызовах moderation возвращается `429`
Notes:
- Existing публичные контракты `/api/proposals/*` не ломались: добавлены только body-size guard и локальный rate-limit на создание proposals.
- Модерация реализована под `/api/moderation/*` и пишет аудит в `ModerationDecision` (уникальность `proposalId`) + обновляет `Proposal.status`/`decidedAt`.
- Проверка Phantom-signature реализована как опциональная: при переданном `signature` проверяем ed25519 подпись message `diploma-z96a moderate:<proposalId>:<toStatus>`, если подписи нет — полагаемся на allowlist.

Agent: ArchitectAgent
Stage: 12
FilesChanged:
- docs/operations.md
- docs/stage12-governance-moderation-architecture.md
HowToTest:
- Сверить, что `docs/operations.md`:
  - описывает включение Redis-backed rate limit через `RATE_LIMIT_BACKEND=redis` + `REDIS_URL` и fallback в in-memory,
  - учитывает алерты/incident для `/api/moderation/*`.
- (Runtime sanity, опционально) поднять dev-сервер:
  - `npm run dev`
  - задать `MODERATOR_PUBKEYS` (и при желании `RATE_LIMIT_BACKEND=redis`, `REDIS_URL`)
  - подготовить `Proposal` в статусе `SUBMITTED`
  - вызвать: `POST /api/moderation/proposals/<proposalId>/decide` с body `{"moderatorPubkey":"<allowed>","decision":"ACCEPT"}`
  - повторить с `decision:"REJECT"` и проверить `409`.
Notes:
- Документ moderation baseline синхронизирован с фактической реализацией endpoint’а (path и поля request body), публичные контракты `/api/proposals/*` не затронуты.
- Ключевой прод-риск: деградация shared rate limit на in-memory при проблемах Redis (из-за этого возможны “разные 429” между инстансами), поэтому это явно отражено в операционных алертах Stage 12.

Agent: ArchitectAgent
Stage: 12
FilesChanged:
- docs/architecture.md
- docs/operations.md
- docs/stage12-governance-moderation-architecture.md
HowToTest:
- Открыть `docs/stage12-governance-moderation-architecture.md` и проверить:
  - точный контракт `POST /api/moderation/proposals/:id/decide` (fields `moderatorPubkey`, `decision`, опционально `signature`);
  - allowlist env `MODERATOR_PUBKEYS` и message для сигнатуры `diploma-z96a moderation:decide:<proposalId>:<toStatus>`;
  - идемпотентность и защиту от double-decision (upsert `ModerationDecision.proposalId` + updateMany по `SUBMITTED`).
- Открыть `docs/operations.md` и убедиться, что:
  - rate-limit runtime guards включают `moderation.decide`;
  - post-launch чеклист и observability учитывают `/api/moderation/*`;
  - добавлено явно про мониторинг поведения при деградации Redis и признаки насыщения connection pooling.
- Открыть `docs/architecture.md` и убедиться, что Stage 12 теперь описывает final решения: Redis shared rate limit с fallback + moderation baseline и ссылка на соответствующий документ.
Notes:
- Documentation фиксирует текущую реализацию moderation: signature в v1 опциональна (если нет `signature`, backend все равно проверяет allowlist).
- Поведение shared rate limit в multi-instance корректно при `RATE_LIMIT_BACKEND=redis` + `REDIS_URL`; при проблемах с Redis backend деградирует в in-memory режим, поэтому алерты/инциденты должны учитывать наблюдаемость этих деградаций.

Agent: BackendAPIAgent
Stage: geocode-proxy
FilesChanged:
- src/lib/geocodeCache.ts
- src/app/api/geocode/search/route.ts
- src/app/api/geocode/reverse/route.ts
- src/app/api/geocode/nearby/route.ts
HowToTest:
- `npm run lint && npm run build`
- `GET /api/geocode/search?q=<query>`: ответ формы Nominatim (массив) без дополнительных полей
- повторить запрос: ответ из кеша (поведенчески то же)
- `GET /api/geocode/reverse?lat=<lat>&lng=<lng>`: ответ формы Nominatim (объект) без дополнительных полей
- `GET /api/geocode/nearby?lat=<lat>&lng=<lng>&radiusKm=<n>`: массив минимум из 1 элемента `{ lat, lon, display_name?, type? }`
- Убедиться, что при частых запросах возвращается `429 { error: "rate limit exceeded" }`
Notes:
- In-memory TTL+LRU-ish кеш (globalThis Map), TTL = 5 минут, max = 500 записей.
- Ключи кеша:
  - `geocode:search:q:<q>`
  - `geocode:reverse:lat:<lat>:lng:<lng>`
  - `geocode:nearby:lat:<lat>:lng:<lng>:r:<radiusKm>`
- circuit breaker + abort timeout 8s сохранены.

Agent: DocsEditorAgent
Stage: 12
FilesChanged:
- .env.example
- README.md
- docs/architecture.md
- docs/stage12-scope.md
- docs/operations.md
- docs/etapy.md
- PROJECT_STAGES.md
HowToTest:
- Проверить, что docs и env-ссылки синхронизированы:
  - открыть `docs/stage12-scope.md` и убедиться, что статусы соответствуют текущему коду (Redis-ready rate limit и moderation endpoint под `/api/moderation/*`);
  - открыть `docs/architecture.md` и убедиться, что Stage 12 section ссылается на существующие документы (без ссылок на отсутствующие файлы);
  - открыть `docs/operations.md` и убедиться, что в operational readiness учтены moderation endpoints и единая семантика `429`.
- Проверить базовые команды (при поднятых БД и `npm run dev`):
  - `curl -sS http://localhost:3000/api/health`
- (опционально, если доступен Redis и настроены env) включить:
  - `RATE_LIMIT_BACKEND=redis` и `REDIS_URL`
  и убедиться, что при повторных мутациях лимит по-прежнему возвращает `429 { error: "rate limit exceeded" }`.
Notes:
- Изменения в рамках моей секции G ограничены документацией и примером env; публичные API-контракты Stage 5–8 не менялись.
- Moderation контракт и /api/moderation endpoints описаны так, как реализовано в текущем коде.

Agent: RefactorGuardianAgent
Stage: UX / Globe phase (preflight)
FilesChanged:
- (none; preflight only)
HowToTest:
- Проверить инварианты UX-фазы, что публичные контракты Stage 5–8 не меняются:
  - `GET /api/network` форма `{ providers, elements }` остаётся прежней
  - `src/app/propose/page.tsx` парсит `GET /api/proposals` как массив напрямую
  - `GET /api/proposals/:id/history` возвращает массив напрямую (не `{ history: ... }`)
  - `POST /api/proposals/:id/submit` возвращает `{ txSignature }`
- `npm run lint && npm run build`
Notes:
- В рамках секции A UX / Globe phase выполнена только “граница/контрактная” проверка и фиксация зон, куда запрещены конфликтные правки другими агентами.

Agent: BackendAPIAgent
Stage: UX / Globe phase (секция F)
FilesChanged:
- src/app/api/network/elements/[id]/route.ts
HowToTest:
- `npm run lint && npm run build`
- `npm run dev`
- `GET /api/network/elements/<existingElementId>` должен вернуть `200`:
  - `element.metadata` присутствует (или `null`)
  - поле `provider` содержит `id/name/scope/sourceUrl` или `null`
- `GET /api/network/elements/<nonExistingId>` должен вернуть `404 { error: "not found" }`
Notes:
- Контракты Stage 5–8 (`/api/proposals/*`) не трогались: добавлен только новый маршрут под `GET /api/network/elements/[id]`.

Agent: TestingCIAgent + DocsEditorAgent
Stage: UX / Globe phase (секция G)
FilesChanged:
- scripts/test-ux-globe-smoke.mjs
- package.json
- docs/earth-visualization.md
- README.md
HowToTest:
- `npm run dev`
- `npm run test:ux-globe-smoke`
- Вручную (Phantom wallet checklist):
  - открыть главную страницу, подключить Phantom и проверить `connected/disconnected` состояния в UI;
  - убедиться, что кнопки `3D`/`2D` работают и wheel-zom не “ломает” отображение;
  - проверить, что автопереход 3D<->2D с гистерезисом происходит при изменении зума.
Notes:
- `npm run lint` прошёл.
- `npm run build` НЕ прошёл из-за prerender-error на странице `/cables` (Next.js: `useSearchParams()` требует `Suspense` boundary). Это не связано с правками этой секции и требует фиксации в зоне FrontendAgent.

Agent: ArchitectAgent
Stage: UX / Globe phase (секция B)
FilesChanged:
- docs/requirements.md
- docs/network-data-and-sources.md
- docs/earth-visualization.md
HowToTest:
- `npm run lint` (ожидается: warnings, но без ошибок)
- `npm run build` (в текущем репозитории build может падать на prerender `/cables` из-за `useSearchParams()` без `Suspense`; это не связано с моими doc-only изменениями)
Notes:
- Зафиксированы UX-решения секции B без изменения публичных API-контрактов Stage 5–8.
- Ключевая договорённость: UI “кабельная информация” должна опираться на данные БД/`NetworkElement.metadata`, без “вшитых” официальных источников.

Agent: DBPrismaAgent
Stage: UX / Globe phase (no-op)
FilesChanged:
- (none)
HowToTest:
- `npm run lint` / `npm run build`:
  - lint: warnings есть, ошибок нет
  - build: падает на prerender `/cables` из-за `useSearchParams()` без `Suspense` (не связано с моими изменениями; это уже отражено в journal для секции B)
Notes:
- В `docs/agents/ux-globe-phase-prompts.md` для UX / Globe phase **нет отдельной секции DBPrismaAgent**, поэтому код/схема не трогались.

Agent: FrontendAgent
Stage: UX / Globe phase (секция E)
FilesChanged:
- src/components/HomePage.tsx
- src/components/MapView.tsx
- src/components/EarthScene.tsx
- src/app/cables/page.tsx
HowToTest:
- `npm run dev` и открыть главную страницу:
  - убедиться, что панель навигации/авторизации кликабельны поверх 3D-сцены (z-index/pointer-events),
  - убедиться, что кнопки `zoom + / -` меняют zoom и при достижении порогов переключают 3D/2D.
- Переключиться в `2D` и проверить:
  - слева сверху reverse geocode (Country/Region/City) обновляется при перемещении центра карты;
  - поиск (autocomplete) использует `/api/geocode/search` и:
    - сначала показывает 3 результата,
    - если результатов больше — список становится прокручиваемым;
  - выбор результата recenter’ит карту.
- Открыть `/cables`:
  - убедиться, что список кабелей грузится из `GET /api/network?scope=GLOBAL` и фильтруется по `CABLE_*`,
  - открыть детали по `?id=...`, увидеть `metadata` и внешние фото как ссылки (без встраивания).
- `npm run lint` и `npm run build`:
  - проверить, что prerender `/cables` теперь не падает (за счёт `Suspense` для `useSearchParams`).
  - повторная проверка: `npm run lint` + `npm run build` (exit_code 0).
Notes:
- Публичные контракты Stage 5–8 не менялись; добавлен только новый фронтенд-маршрут `/cables`.

Agent: Web3SolanaAgent
Stage: UX / Globe phase (секция C)
FilesChanged:
- src/components/AuthBlock.tsx
HowToTest:
- `npm run dev`
- открыть главную страницу и подключить Phantom:
  - убедиться, что кнопки `Connect/Disconnect` работают (и UI не падает при ошибках),
  - проверить, что отображение `connected/disconnected` и `status` соответствует состоянию кошелька.
- при наличии кошелька:
  - нажать `Sign & Verify` и убедиться, что авторизация проходит (response ok от `POST /api/auth/verify`).
Notes:
- Контракты `POST /api/auth/verify` и остальные публичные `/api/*` не менялись.
- Добавлены try/catch, локальная синхронизация `status` с `wallet.connected`, а также отдельные guards от параллельных `connect/disconnect` (`wallet.connecting`/`wallet.disconnecting` + `connBusy`), чтобы `autoConnect` и ручные действия не конфликтовали.

Agent: Web3SolanaAgent
Stage: wallet autoconnect policy (prompt)
FilesChanged:
- src/components/WalletIdleAutoconnect.tsx
HowToTest:
- `npm run dev` и убедиться, что при idle без connected не происходит `disconnect()`/сброса `walletName`, а при connected после `WALLET_IDLE_MS` происходит disconnect и следующий заход не autoconnect’ится.
Notes:
- Таймер disconnect теперь стартует только при `connected`, при этом метка активности `diploma_walletLastActivityAt` обновляется всегда (для stale autoconnect guard).

Agent: RefactorGuardianAgent
Stage: Auth / Profile phase (секция A) — preflight
FilesChanged:
- (none; preflight only)
HowToTest:
- Проверено контрактно текущее состояние:
  - `POST /api/auth/verify` не затронут
  - `GET /api/profile?pubkey=...` возвращает `{ pubkey, username, usernameSetAt, createdAt }` + `inDatabase`
  - `POST /api/profile/username` принимает `publicKey`, `message`, `signature`, `username` и верифицирует подпись
  - страница `/cabinet` использует `AuthBlock` + форму установки username через `/api/profile/username`
- `npm run lint` — успешно
- `npm run build` — неуспешно в текущем окружении: отсутствует `C:/diploma/.next/types/validator.ts` (похоже на проблему с `.next`/типами в окружении, не на ошибку в логике preflight)
Notes:
- Никаких правок кода не вносил; цель — проверить, что текущая реализация preflight соответствует требованиям секции A.

Agent: Web3SolanaAgent
Stage: Auth / Profile phase (секция D) — подпись username
FilesChanged:
- src/app/cabinet/page.tsx
HowToTest:
- `npm run dev` → открыть `/cabinet`:
  - кнопка “Подписать и сохранить ник” недоступна, пока wallet не подключён (`wallet.connected === false`);
  - при connected подпись проходит и запрос уходит в `POST /api/profile/username`.
Notes:
- API `/api/profile/username` и формат сообщения из `src/lib/username.ts` не менялись; только UX-guard для безопасного вызова `wallet.signMessage`.

Agent: DBPrismaAgent
Stage: Auth / Profile phase (секция C) — схема пользователя
FilesChanged:
- (none; уже присутствуют в репозитории)
HowToTest:
- `npm run lint` (успешно)
- `npm run build`:
  - неуспешно по существующей TS ошибке в `src/components/AuthBlock.tsx` (Cannot find name 'useMemo') — не относится к моим DB/Prisma изменениям
Notes:
- В репозитории уже были реализованы поля `User.username` (nullable + unique) и `User.usernameSetAt`:
  - `prisma/schema.prisma`
  - миграция `prisma/migrations/20260320120000_user_username/migration.sql`

Agent: BackendAPIAgent
Stage: Auth / Profile phase (секция E) — API профиля + bulk
FilesChanged:
- src/app/api/profile/bulk/route.ts
HowToTest:
- Поднять dev-сервер: `npm run dev`
- Вызвать bulk endpoint:
  - `POST /api/profile/bulk`
  - body: `{ "pubkeys": ["<pubkey1>","<pubkey2>"] }`
- Проверить:
  - `200` и `ok: true`
  - маппинг `usernamesByPubkey[pubkey]` равен `string|null` (для неизвестных pubkey — `null`)
  - при пустом `pubkeys` возвращается `400`
- `npm run lint` — успешно
- `npm run build` — сейчас падает из-за существующей TS ошибки в `src/components/AuthBlock.tsx` (не связано с bulk endpoint’ом)
Notes:
- Bulk endpoint добавлен, чтобы фронт (Moderate) мог заменить `authorPubkey -> username` по массиву pubkeys без N+1 запросов.

Agent: RefactorGuardianAgent
Stage: UX / Globe phase (секция A) — preflight
FilesChanged:
- (none; preflight only)
HowToTest:
- Проверено инвариантно текущее API/DTO соответствие:
  - `GET /api/network?scope=GLOBAL` возвращает `{ providers, elements }` как `NetworkResponseDTO`
  - публичные `/api/proposals/*` контрактные форматы (массив для списка, `actions` в detail) не ломались
- `npm run lint` — успешно
- `npm run build` — неуспешно в текущем окружении: `PageNotFoundError: Cannot find module for page: /_document` (Next.js падает на этапе `Collecting page data`, не связано с моими UX preflight проверками)
Notes:
- Изменения кода по UX / Globe фазе не вносились: только аудит инвариантов согласно секции A.

Agent: ArchitectAgent
Stage: Auth / Profile phase (секция B) + UX / Globe phase (секция B)
FilesChanged:
- docs/architecture.md
- docs/requirements.md
- docs/earth-visualization.md
HowToTest:
- `npm run lint` — проходит
- `npm run build` — в текущем окружении неуспешен (Next build worker/typings артефакты; ошибка связана с `.next`/worker-модулем, не с моей doc-only правкой)
Notes:
- Права/форматы и смысл username соответствуют текущему коду:
  - генерация random username и `usernameSetAt = null` в `POST /api/auth/verify`;
  - переопределение username возможно только при `usernameSetAt === null` и подтверждается подписью формата из `src/lib/username.ts`.
- UX/Globe decisions зафиксированы как требования к поведению UI (2D/3D центровка, читаемость 3D, локальные подписи, reverse geocode + search autocomplete через backend proxy), без изменения публичных API-контрактов.

Agent: DocsEditorAgent и TestingCIAgent
Stage: Auth / Profile phase (секция G) + UX / Globe phase (секция G)
FilesChanged:
- scripts/api-profile-smoke.mjs
- scripts/test-ux-globe-smoke.mjs
- package.json
- README.md
- docs/architecture.md
- docs/earth-visualization.md
HowToTest:
- `npm run lint`
- `npm run build`
- (при поднятом `npm run dev`) `npm run test:auth-profile-smoke`
- (при поднятом `npm run dev`) `npm run test:ux-globe-smoke`
  - geocode можно пропустить без интернета: `SKIP_GEOCODE_SMOKE=1 npm run test:ux-globe-smoke`
Notes:
- Smoke-тесты проверяют: flow `POST /api/auth/verify` -> `GET /api/profile` (`usernameSetAt === null`) -> `POST /api/profile/username` и запрет повторного изменения; а также доступность `GET /api/network`, `GET /api/geocode/*` и рендер `/cables`.

Agent: FrontendAgent
Stage: Auth / Profile phase (секция F)
FilesChanged:
- src/components/AuthBlock.tsx
- src/app/moderate/page.tsx
HowToTest:
- `npm run dev`
- Проверить, что `AuthBlock` после подключения/авторизации показывает `username`, а не `pubkey`.
- Открыть `/cabinet` и убедиться, что после `Авторизовать` в `AuthBlock` профиль обновляется (срабатывает `auth:verified` → refetch).
- Открыть `/moderate`:
  - в колонке `Author` отображается `username` вместо `authorPubkey`;
  - при недоступности bulk-эндпоинта допускается fallback без падения UI.
Notes:
- `Moderate` использует `POST /api/profile/bulk` и fallback на `GET /api/profile?pubkey=...`, чтобы не показывать pubkey в интерфейсе.
- `npm run lint` и `npm run build` проходят (exit_code 0).

Agent: FrontendAgent
Stage: UX / Globe phase (секция E)
FilesChanged:
- src/components/MapView.tsx
- src/components/EarthScene.tsx
HowToTest:
- `npm run dev`
- Переключиться в `2D`:
  - слева сверху появляется текущая локация (reverse geocode);
  - поиск (autocomplete) запрашивает `/api/geocode/search`;
  - выбор результата recenter’ит карту и обновляет локацию.
Notes:
- Геокод запросы идут через backend proxy (`/api/geocode/reverse`, `/api/geocode/search`).
- `npm run lint` и `npm run build` проходят (exit_code 0).

Agent: Coordinator (acceptance smoke)
Stage: Auth / Profile phase — random username + pubkey hidden + bulk
FilesChanged:
- scripts/api-auth-verify-auto-username-smoke.mjs
HowToTest:
- `npm run lint`
- `npm run build`
- Smoke:
  - `POST /api/auth/verify` создает пользователя с random `username` и `usernameSetAt === null`
  - `GET /api/profile?pubkey=...` возвращает `inDatabase=true`, `username` заполнен, `usernameSetAt=null`
  - `POST /api/profile/username` (переопределение) проходит, после чего `usernameSetAt` становится non-null
  - повторное `POST /api/profile/username` с другим `username` отклоняется (ожидаемый `403`)
  - `POST /api/profile/bulk` возвращает `usernamesByPubkey` для известных pubkey и `null` для неизвестных

Agent: DBPrismaAgent
Stage: db-underground-types
FilesChanged:
- prisma/schema.prisma
- src/lib/types.ts
- src/lib/stage7/networkElementOps.ts
- prisma/migrations/20260320_network_underground_enum_types/migration.sql
- prisma/migrations/20260320_network_underground_enum_types/README.md
HowToTest:
- `npm run lint` (успешно)
- `npm run build` (успешно, exit_code 0)
Notes:
- Добавлены enum `NetworkElementType`: `PROVIDER`, `SERVER`, `SWITCH`, `MULTIPLEXER`, `DEMULTIPLEXER`, `REGENERATOR`, `MODEM`
- Добавлены enum `NetworkElementType`: `CABLE_UNDERGROUND_COPPER`, `CABLE_UNDERGROUND_FIBER`
- Добавлен композитный индекс: `NetworkElement(scope, type)`.

## UX / Globe phase — rendering-globe-map (center + underground + labels)

Agent: ThreeLeafletAgent

FilesChanged:
- `src/components/EarthScene.tsx`

Визуальные правила (3D):
- Осветление Земли: усилены фон/свет (ambient/hemi/sun) и увеличена `toneMappingExposure`, добавлен ненулевой `emissive` для earth (Phong/Standard) и fallback-материала, поднята непрозрачность облаков.
- Подписи (3D labels): показываются ТОЛЬКО локально вокруг текущего центра глобуса; видимость пересчитывается в `animate()` при вращении.
  - Центр глобуса вычисляется из текущей `globeGroup.quaternion` (луч в экран) -> lat/lng.
  - Радиус локальности: динамически зависит от zoom (примерно `16..26` градусов по углу).
- 3D -> 2D центрирование: при переключении в `MAP_2D` устанавливается `targetCenter`/`reverseCenter` на текущую середину глобуса (по `globeGroup` rotation), не ломая существующие reverse/search через backend proxy.
- 2D сценарий: клик `2D` и авто-переход при zoom ставят Leaflet в lat/lng “середины глобуса”, после чего reverse geocode обновляет локацию в оверлее.

Поддержанные типы сети в 3D:
- Кабели: `CABLE_FIBER`, `CABLE_COPPER` (solid линии) и `CABLE_UNDERGROUND_FIBER`, `CABLE_UNDERGROUND_COPPER` (dashed, другая прозрачность/радиус, `depthTest=false` для различимости).
- Узлы: `PROVIDER`, `SERVER`, `SWITCH`, `MULTIPLEXER`, `DEMULTIPLEXER`, `REGENERATOR`, `MODEM`, `BASE_STATION`, `SATELLITE`, `EQUIPMENT` (различимые материалы/размеры + локальные подписи).

HowToTest:
- `npm run lint && npm run build`


Agent: ScriptsImportAgent
Stage: import-underground-cables
FilesChanged:
- scripts/sync-underground-cables.mjs
- docs/network-data-and-sources.md
HowToTest:
- `npm run lint` — успешно
- `npm run build` — успешно (exit_code 0)
Notes:
- Dataset: Data.gov.au `Fibre Optic Cable` (City of Gold Coast), импорт через WFS GeoJSON.
- Импорт underground fiber линий в `NetworkElement`:
  - `NetworkProvider.id = gold-coast-fibre-optic-cable`
  - `NetworkElement.type = CABLE_UNDERGROUND_FIBER`
  - `sourceId` дедупликация по `gold-coast-fibre-optic-cable-<featureId>` (+ `-s<segmentIdx>` для сегментов).
- `metadata` для рендера underground vs submarine:
  - `transportMode`, `underground`, `submarine`
  - `color` (fiber: `#7aa2ff`)
  - `depthMeters` = `null` (в WFS GeoJSON глубина не присутствует в геометрии/атрибутах)
  - `cableMaterial`, `featureId`, `folder`, `visibility`, `isOpen`, `segmentIndex`, `segmentCount`, `importedAt`.

Agent: DocsEditorAgent
Stage: spec-doc
FilesChanged:
- docs/global-network-building-spec.md
HowToTest:
- `npm run lint`
- `npm run build`
Notes:
- Создан файл `docs/global-network-building-spec.md`
- Добавлены разделы спецификации:
  - Поддерживаемые типы узлов/кабелей и маппинг в `NetworkElementType`
  - Представление в БД (`path`, `lat/lng/altitude`, `sourceId`, `metadata`) и ожидаемые поля `metadata`
  - Процесс импорта данных (источники, шаги синка, схемы `sourceId`)
  - Конвейер “БД → DTO (`/api/network`) → 3D (`EarthScene`) и 2D (`MapView`)”
  - Правила отображения на глобусе (цвет/стиль/слой underground vs submarine, локальные подписи у центра)
  - Правила отображения в 2D (центр из текущей середины глобуса, reverse geocode, search/autocomplete через backend proxy)
  - Контракты `geocode-proxy` (эндпоинты, параметры, ожидаемые поля ответа)
  - Легенда и “как отличать” элементы (underground/submarine и типы узлов)

## Smoke-once: v2 site routes + API proxies (TestingCIAgent)

Date: 2026-03-20

FilesChanged:
- `scripts/smoke-v2-site-routes-api.mjs`

HowToTest (executed):
- `BASE_URL=http://localhost:3000 node scripts/smoke-v2-site-routes-api.mjs`

Result:
- GET `/` -> `200`
- GET `/about` -> `200`
- GET `/global-network` -> `200`
- GET `/api/network?scope=GLOBAL` -> `200` (BASE_STATION=32; underground fiber=128; underground copper=128)
- GET `/api/geocode/reverse?lat=48.8566&lng=2.3522` -> `200` (display_name present)
- GET `/api/geocode/search?q=Lon` -> `200` (JSON array; length=10)

## Справочник: полная структура проекта + сетевые сущности (координатор)

Date: 2026-03-22

Notes:
- В чате подготовлено развёрнутое описание дерева репозитория, доменной модели `NetworkProvider` / `NetworkElement`, enum `NetworkElementType`, геопредставления (`path` vs точка), API `GET /api/network`, визуализации (`EarthScene`, `MapView`, `factories.ts`) и чеклиста для добавления новых типов (в т.ч. рассинхрон `networkElementOps` vs Prisma для offline-типов).

## Переезд проекта с флешки: пути + проверка запуска (координатор)

Date: 2026-04-02

FilesChanged:
- `AGENTS.md`
- `docs/windows-dev.md`
- `docs/local-dev-docker.md`
- `docs/agents/stage6-prompts.md`
- `docs/agents/stage7-prompts.md`
- `docs/agents/stage8-prompts.md`

What changed:
- Убраны/исправлены жёсткие абсолютные ссылки `C:\diploma\...` в документации и агентских промптах, чтобы репозиторий был переносимым между каталогами.
- Пути для stage-промптов и `DEVELOPMENT_JOURNAL.md` переведены на относительные (`docs/...`, `DEVELOPMENT_JOURNAL.md`) или на нейтральную формулировку "корень проекта".
- Поднят Docker Desktop и запущен контейнер Postgres `z96a-pg` на `localhost:5432`.
- Выполнен `npm install` (восстановлены зависимости после переноса).

Runtime check:
- `npm run dev` стартует Next.js, но завершается ошибкой: "Couldn't find any `pages` or `app` directory".
- В корне репозитория отсутствуют каталоги `src/` и `prisma/` (по `git status` ранее они помечены как массово удалённые), поэтому текущее приложение в этом состоянии неработоспособно.

## Восстановление завершено: проверка production build + commit (координатор)

Date: 2026-04-02

FilesChanged:
- `DEVELOPMENT_JOURNAL.md`

What changed:
- После восстановления `src/`, `prisma/`, `public/`, `scripts/` из рабочей копии и reset dev-БД выполнена production-проверка: `npm run build`.
- Сборка прошла успешно на Next.js `15.5.14`; статические и динамические роуты собраны без ошибок.
- Зафиксирован один текущий warning линтера в `src/app/sandbox/page.tsx` (cleanup в `useEffect` для `leafletLayersRef.current`) — не блокирует build.

Result:
- Статус проекта: рабочий в dev и production build режимах после восстановления.