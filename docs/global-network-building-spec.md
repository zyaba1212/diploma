# Global Network Building Spec (from data to render)

Этот документ фиксирует, как приложение наполняет БД “элементами сети” и как затем строит модель рендера для:

- 3D-глобуса (Three.js, `EarthScene`)
- 2D-карты (Leaflet, `MapView`)

Документ опирается на текущие контракты БД/Prisma, DTO API и текущие эндпоинты `geocode-proxy`.

## 1. Термины и источники истины

- **NetworkProvider** — провайдер/датасет, откуда пришли геометрия и элементы.
- **NetworkElement** — единица “сети”, которую отрисовываем: узел (point) или кабель (polyline).
- **NetworkElementType** — enum, определяющий тип элемента (узел/кабель и “underground vs submarine”).
- **sourceId** — ключ идемпотентности импорта (дедупликация сегментов/элементов).
- **path** — массив точек `{lat, lng}` для кабеля (полилиния).
- **metadata** — JSON, где храним фактические поля источника (dataset/license/ID сегмента и т.п.) для UX/карточек и последующего расширения рендера.

Источник истины для рендера:

- Геометрия и тип берутся из полей `NetworkElement`:
  - узлы: `lat/lng` (и опционально `altitude`)
  - кабели: `path`
  - различие submarine vs underground: `NetworkElement.type`
- `metadata` используется как “фактическая справка из импортированных данных” (а не как вшитые допущения UI). Текущая версия рендера использует `type` и геометрию, но `metadata` является частью того, что должно быть доступно UX.

## 2. Доменная модель (Prisma / БД)

### 2.1. `NetworkProvider` (таблица в PostgreSQL через Prisma)

Поля:

- `id: String` (PK)
- `name: String`
- `scope: 'GLOBAL' | 'LOCAL'`
- `sourceUrl: String?` (откуда брали/как атрибутировать)
- связи:
  - `elements: NetworkElement[]`

Визуально в текущем UI `NetworkProvider` используется косвенно (через `NetworkElement.providerId`), но для спецификации важно, что:

- импортеры должны создавать/обновлять `NetworkProvider` перед элементами,
- `sourceUrl` должен быть задан (по крайней мере для демо/импортов).

### 2.2. `NetworkElement` (таблица в PostgreSQL через Prisma)

Поля:

- `id: String` (PK)
- `scope: 'GLOBAL' | 'LOCAL'`
- `type: NetworkElementType` (см. ниже)
- `providerId: String?` и `provider: NetworkProvider?`
- `name: String?` (используется для подписи, если не пустой)
- `sourceId: String? @unique` (идемпотентность импорта)
- Геометрия:
  - `lat: Float?`, `lng: Float?`
  - `altitude: Float?` (в km или как принято в импорте; для спутников рендер предполагает km)
  - `path: Json?` (для кабелей; ожидается `LatLng[]`)
- `metadata: Json?` (схема зависит от типа, но всегда JSON)

Индексы (важно для производительности/фильтрации):

- `@@index([scope, type])`
- `@@index([scope, lat, lng])`
- `@@index([type])`
- `@@index([lat, lng])`

### 2.3. Поддерживаемые типы (`NetworkElementType`)

Enum:

- Кабели:
  - `CABLE_FIBER` — “submarine” fiber (поверхностные линии, не underground)
  - `CABLE_COPPER` — “submarine” copper (поверхностные линии, не underground)
  - `CABLE_UNDERGROUND_FIBER` — underground fiber
  - `CABLE_UNDERGROUND_COPPER` — underground copper
- Узлы:
  - `SERVER` — сервер/дата-центр (узел)
  - `SWITCH` — L2/L3-коммутатор (узел)
  - `MULTIPLEXER` — мультиплексор (узел, DWDM-подобное)
  - `DEMULTIPLEXER` — демультиплексор (узел)
  - `REGENERATOR` — регенератор (узел)
  - `MODEM` — модем/трансивер (узел)
  - `BASE_STATION` — базовая станция (узел)
  - `SATELLITE` — спутник (узел)
  - `EQUIPMENT` — прочее оборудование (узел)
  - `MESH_RELAY`, `SMS_GATEWAY`, `VSAT_TERMINAL`, `OFFLINE_QUEUE` — офлайн / mesh / транзакции (узлы)

Иных значений `NetworkElementType` в схеме нет (расширенная топология и отдельные типы кабелей AERIAL/INDOOR сняты).

Правило “underground vs submarine”:

- если `type` начинается с `CABLE_UNDERGROUND_*` — кабель underground (подземный/терестриальный),
- иначе `CABLE_*` — submarine/поверхностный кабель.

## 3. Представление в БД: geometry + metadata

### 3.1. Кабельные элементы

Обязательное:

- `path` должен быть массивом точек в формате:
  - `LatLng = { lat: number, lng: number }`
- `path` должен содержать минимум 2 точки (иначе кабель не рендерится).

Для различения транспортного режима:

- submarine:
  - `type` ∈ `{CABLE_FIBER, CABLE_COPPER}`
  - `metadata.transportMode` опционально, но допустимо использовать как справочную инфу
- underground:
  - `type` ∈ `{CABLE_UNDERGROUND_FIBER, CABLE_UNDERGROUND_COPPER}`
  - импортер должен (как минимум) хранить фактический транспортный режим в `metadata`:
    - `transportMode: 'underground' | 'submarine' | ...`
    - boolean-флаги `underground/submarine` (как минимум для underground импорта сейчас)

### 3.2. Узловые элементы

Обязательное:

- `lat` и `lng` должны быть числами.
- `altitude`:
  - может быть null
  - для `SATELLITE` рендер использует altitude для вычисления “высоты” над поверхностью (в km в текущей логике).

Подписи:

- текст подписи определяется как:
  - `el.name.trim()` если `name` непустой
  - иначе используется `type` (enum-строка).

### 3.3. `metadata` (ожидаемые поля)

`metadata` — свободный JSON, но ниже фиксируем то, что сейчас реально импортируется скриптами и что должно быть доступно UX как “фактические поля источника”.

#### 3.3.1. Общие поля для кабелей

Минимальный набор (рекомендуется):

- `dataset: string` — название датасета
- `licenseNote: string` — заметка о лицензии/атрибуции
- `importedAt: string` — ISO timestamp импорта

Опциональные:

- `featureId: string | number | null`
- `cableId: string | number | null`
- `color: string | null` (если входные данные содержат цвет)

#### 3.3.2. `CABLE_FIBER/CABLE_COPPER` (submarine)

Текущий submarine импорт задаёт (через `scripts/sync-submarine-cables.mjs`):

- `dataset: 'open_undersea_cable_map'`
- `licenseNote: 'CC BY-NC-SA 3.0 — verify non-commercial use'`
- `featureId: feature.properties.feature_id | null`
- `cableId: feature.properties.id | null`
- `color: feature.properties.color | null`
- `importedAt: <ISO>`

Дополнительно (если не указан флаг **`--no-details`** в скрипте): для каждого уникального `feature.properties.id` выполняется HTTP-загрузка файла `cable/<id>.json` из того же репозитория (база URL по умолчанию совпадает с каталогом `cable/` на `raw.githubusercontent.com`; переопределение — **`SUBMARINE_CABLE_DETAIL_BASE_URL`**, строка с завершающим `/`). Из ответа в `metadata` попадают:

- `year: number | отсутствует` — из `rfs_year`, иначе из префикса строки `rfs` (первые четыре цифры, если есть)
- `countries: string[] | отсутствует` — уникальные значения `landing_points[].country`, отсортированные лексикографически
- `rfs: string | отсутствует` — сырая строка `rfs` (например «2020 Q2»), если задана
- `officialUrl: string | отсутствует` — из поля `url` в `cable/<id>.json`, только если после обрезки пробелов строка начинается с `http://` или `https://` и парсится как URL с тем же протоколом (иначе не сохраняется)

При ошибке загрузки или отсутствии файла для конкретного `id` сегмент всё равно импортируется с базовыми полями выше; год и страны для него могут отсутствовать.

**Отображение в UI (`global-network`):** блок «Источники» строится единым helper для всех типов объектов (кабели и узлы), если доступны валидные URL из `metadata`/`provider`:

- «Сайт проекта / оператора» — при наличии `metadata.officialUrl` (или совместимого URL-поля в metadata),
- «Источник провайдера» — из `NetworkProvider.sourceUrl`,
- «Ссылка на датасет/запись» — по типу и метаданным объекта (например, `cable/<id>.json` для OUCM, OSM permalink, data.gov.au, Celestrak),
- «Поиск в Wikipedia (EN)» — для подводных кабелей; это URL **поиска**, не гарантированная статья и не подтверждение трассы.

#### 3.3.3. `CABLE_UNDERGROUND_FIBER/CABLE_UNDERGROUND_COPPER` (underground)

Текущий underground импорт задаёт (через `scripts/sync-underground-cables.mjs`):

- `dataset: 'gold_coast_fibre_optic_cable'`
- `licenseNote: <текст лицензии CC BY 3.0 AU + атрибуция>`
- транспорт и флаги:
  - `transportMode: 'underground'`
  - `underground: true`
  - `submarine: false`
- материал:
  - `cableMaterial: 'fiber'` (или ожидаемо `'copper'` при будущем медном импорте)
- геометрическая глубина:
  - `depthMeters: null` (WFS GeoJSON в текущем датасете глубину не отдаёт в геометрии/атрибутах)
- идентификаторы и сегментация:
  - `featureId: <id из source>`
  - `folder: string | null`
  - `visibility: boolean | null`
  - `isOpen: boolean | null`
  - `segmentIndex: number`
  - `segmentCount: number`
- `importedAt: <ISO>`

#### 3.3.4. Узлы (`SERVER/...`)

Текущий `scripts/sync-satellites.mjs` оставляет пока минимальную metadata для спутника:

- `metadata: { importedAt: <ISO> }`

Для будущих импортов узлов рекомендуется:

- `dataset` и `licenseNote`, если доступны из источника,
- `importedAt`,
- физические атрибуты, если они реально есть в данных (например, для базовых станций/оборудования),
- дополнительные справочные поля — как JSON (не расширяя API/DTO).

## 4. Импорт данных (источники, шаги синка, metadata)

### 4.1. Общий процесс синка (для любого типа элементов)

1) Выбрать датасет и проверить лицензию/атрибуцию.
2) (Опционально) Подготовить локальный JSON/GeoJSON для воспроизводимости через `--file`.
3) Запустить соответствующий импорт-скрипт.
4) Скрипт:
   - делает `NetworkProvider.upsert` (фиксирует `provider.id`, `name`, `scope`, `sourceUrl`),
   - затем делает `NetworkElement.upsert` для каждой сущности сегмента/линии:
     - `where: { sourceId }` (идемпотентность)
     - `create` и `update` должны устанавливать:
       - `type`, `providerId`, `scope`
       - геометрию (`path` или `lat/lng`)
       - `name` (если доступно)
       - `metadata` (из входных полей источника)

### 4.2. Подводные кабели (submarine)

- Скрипт: `scripts/sync-submarine-cables.mjs`
- Источник:
  - Open Undersea Cable Map (fork TeleGeography), репозиторий:
    - https://github.com/stevesong/open_undersea_cable_map
- URL по умолчанию: `.../cable/cable-geo.json`
- Env/per-file:
  - `SUBMARINE_CABLE_GEO_URL` (подмена URL)
  - `SUBMARINE_CABLE_DETAIL_BASE_URL` (база для `cable/<id>.json`, по умолчанию каталог `cable/` того же репозитория)
  - `--file path/to/cable-geo.json`
  - `--no-details` — не запрашивать `cable/<id>.json` (без `year` / `countries` в metadata)

Идемпотентность:

- `NetworkProvider.id = open-undersea-cable-map`
- `NetworkElement.sourceId` вида:
  - `oucm-<feature_id>`
  - при нескольких сегментах: `oucm-<feature_id>-s<segIdx>`

Тип:

- `NetworkElement.type = CABLE_FIBER` (в текущей версии скрипта)

Metadata — см. раздел `3.3.2`.

### 4.3. Подземные/терестриальные кабели (underground / terrestrial)

- Скрипт: `scripts/sync-underground-cables.mjs`
- Источник (City of Gold Coast, Data.gov.au):
  - Dataset: https://data.gov.au/data/dataset/fibre-optic-cable
  - WFS GeoJSON по умолчанию в скрипте (GeoServer → WFS → JSON)
- Env/per-file:
  - `UNDERGROUND_CABLE_GEO_URL` (подмена URL)
  - `--file path/to/underground.json`

Идемпотентность:

- `NetworkProvider.id = gold-coast-fibre-optic-cable`
- `NetworkElement.sourceId` вида:
  - `gold-coast-fibre-optic-cable-<featureId>`
  - при сегментах: `gold-coast-fibre-optic-cable-<featureId>-s<segmentIndex>`

Тип:

- `NetworkElement.type = CABLE_UNDERGROUND_FIBER` (в текущей версии скрипта)

Metadata — см. раздел `3.3.3`.

### 4.4. Узлы (пока минимально)

Текущий `scripts/sync-satellites.mjs` — заглушка под спутники:

- `NetworkProvider.id = satellites`
- `NetworkProvider.sourceUrl = https://celestrak.org/`
- `NetworkElement.type = SATELLITE`
- `NetworkElement.lat/lng/altitude` берутся из placeholder

На практике добавление точек высадки/земных точек и расширение узлов должно следовать общему процессу (раздел `4.1`) и фиксировать фактические поля в `metadata`.

## 5. Из БД в модель рендера

### 5.1. Backend API: `/api/network`

Эндпоинт: `GET /api/network`

Query params:

- `scope=GLOBAL | LOCAL` (опционально; влияет на выбор элементов по `NetworkElement.scope`)
- `bbox=minLat,minLng,maxLat,maxLng` (опционально; логика bbox применяется только по смыслу для `LOCAL`, в текущей реализации фильтрация делается по `lat/lng` не-NULL и диапазонам)

Ответ:

- JSON:
  - `providers: NetworkProviderDTO[]`
  - `elements: NetworkElementDTO[]`

`NetworkElementDTO` в приложении содержит:

- `id`, `scope`, `type`, `providerId?`, `name?`, `sourceId?`
- `lat?`, `lng?`, `altitude?`
- `path?: LatLng[] | null` (при кабелях)
- `metadata?: Record<string, unknown> | null`

### 5.2. Модель рендера в 3D (`EarthScene`)

Ключевой конвейер:

1) Клиент делает `fetch('/api/network?scope=...')` и получает `NetworkResponseDTO`.
2) Далее в `useEffect` “пересобирается” `networkGroup` (все предыдущие объекты утилизируются).
3) Для каждого `NetworkElement el`:
   - если `el.type` — кабель и у него есть `el.path`, создаётся `THREE.Line`:
     - submarine:
       - `CABLE_FIBER` и `CABLE_COPPER` → сплошная линия (`LineBasicMaterial`)
     - underground:
       - `CABLE_UNDERGROUND_FIBER` и `CABLE_UNDERGROUND_COPPER` → пунктир (`LineDashedMaterial`)
     - геометрия:
       - каждая точка `path` переводится в `THREE.Vector3` через `latLngToVec3(lat, lng, radius)`
       - `radius` для кабелей выбирается как “слой”:
         - underground: `radius = 0.992`
         - submarine: `radius = 1.001`
   - иначе, если `el.lat/el.lng` — числа, создаётся узел:
     - маркер-сфера (`THREE.Mesh`) на позиции `latLngToVec3(lat, lng, nodeR)`
     - `nodeR` учитывает:
       - `SATELLITE`: `1.0 + altitudeKm/6371`
       - остальные: базовый радиус + масштаб от размера типа
   - подпись:
     - создаётся `THREE.Sprite` с текстом `el.name ?? type`
     - sprite не показывается сразу, видимость обновляется в `animate()` по текущему “центру глобуса” (локально у центра).

### 5.3. Модель рендера в 2D (`MapView`)

Ключевой конвейер:

1) Когда активен `MAP_2D`, `EarthScene` передаёт в `MapView`:
   - `network`
   - `center` (координаты для `map.setView`)
   - `onCenterChanged` для обновления reverse геокодинга.
2) В `MapView`:
   - добавляется tile layer (`/api/tile?...&source=osm|esri`)
   - при изменениях `network`:
     - кабели рисуются polyline’ами по `el.path`
     - узлы — круговыми маркерами по `el.lat/el.lng`
   - при перемещении карты:
     - на `moveend` вызывается `onCenterChanged({lat,lng})`
     - `EarthScene` по `reverseCenter` делает reverse geocode и обновляет строку локации.

## 6. Правила отображения на глобусе (3D)

### 6.1. Цвета/стили для кабелей (submarine vs underground)

Палитра задаётся фиксированно по `NetworkElement.type`:

- `CABLE_FIBER` (submarine fiber)
  - цвет: `0x7aa2ff`
  - материал: `LineBasicMaterial`
  - opacity: `0.9`
  - стиль: сплошная линия
- `CABLE_COPPER` (submarine copper)
  - цвет: `0xf6c177`
  - материал: `LineBasicMaterial`
  - opacity: `0.9`
  - стиль: сплошная линия
- `CABLE_UNDERGROUND_FIBER` (underground fiber)
  - цвет: `0x4fd7ff`
  - материал: `LineDashedMaterial`
  - opacity: `0.62`
  - dash: `dashSize=0.04`, `gapSize=0.03`
  - слой:
    - `radius = 0.992`
  - рендер-доступность:
    - `depthTest=false`, `depthWrite=false` (чтобы underground читался даже при непрозрачной Земле)
- `CABLE_UNDERGROUND_COPPER` (underground copper)
  - цвет: `0xffd28a`
  - материал: `LineDashedMaterial`
  - opacity: `0.55`
  - dash: `dashSize=0.04`, `gapSize=0.03`
  - слой:
    - `radius = 0.992`
  - `depthTest=false`, `depthWrite=false`

### 6.2. “Толщина”/размеры

- Кабели в текущем рендере используют `LineBasicMaterial/LineDashedMaterial` без параметра “ширины”. Визуальная “толщина” достигается:
  - выбранным типом материала (сплошная vs пунктир),
  - различием слоя (`radius`) и opacity.
- Узлы рисуются сферами разных размеров по `nodeVisuals.size`.

### 6.3. Цвета/размеры узлов

В текущей логике узлы маппятся на визуальные параметры (из `nodeVisuals`):

- `SERVER`: size `0.018`, color `0x3ddc97`, emissive `0x0f4a2e`
- `SWITCH`: size `0.014`, color `0xf6c177`, emissive `0x3b2b10`
- `MULTIPLEXER`: size `0.012`, color `0xe6a7ff`, emissive `0x3a1456`
- `DEMULTIPLEXER`: size `0.012`, color `0xb36cff`, emissive `0x1d0840`
- `REGENERATOR`: size `0.016`, color `0x7df1ff`, emissive `0x08374a`
- `MODEM`: size `0.010`, color `0xff7d7d`, emissive `0x3a0e0e`
- `BASE_STATION`: size `0.020`, color `0xffc3a0`, emissive `0x3a240f`
- `SATELLITE`: size `0.012`, color `0x9fe7ff`, emissive `0x0a2b3d`
- `EQUIPMENT`: size `0.010`, color `0xffffff`, emissive `0x111133`

### 6.4. Слои (layering) и читаемость

Основные принципы:

- Кабели underground рисуются “чуть внутри” поверхности (`radius=0.992`) и используют `depthTest=false`, чтобы не исчезать на непрозрачной Земле.
- Кабели submarine рисуются “чуть снаружи” (`radius=1.001`).
- Узлы независимы от типа кабеля: они всегда рисуются по координатам и собственному `nodeR`.

### 6.5. Подписи “локально у центра”

Чтобы не перегружать сцену, подписи узлов отображаются **только в окрестности текущего “центра глобуса”**.

Механика:

- `EarthScene` вычисляет “центр” из направления камеры и текущей инвертированной rotation `globeGroup` (`computeGlobeCenterLatLng`).
- В `animate()` для каждой подписи считается скалярное условие видимости через косинус углового расстояния:
  - `cand.sprite.visible = cosd >= cosRadius`
- Порог углового радиуса зависит от zoom:
  - `zoom < 2.0` → `labelRadiusDeg = 16`
  - `2.0 <= zoom < 3.0` → `20`
  - `zoom >= 3.0` → `26`

Итог:

- при вращении глобуса локальные подписи “подстраиваются” к текущему центру экрана,
- при приближении радиус локальной видимости увеличивается.

## 7. Правила отображения в 2D (Leaflet)

### 7.1. Центрирование на “текущую середину” глобуса

Переход 3D → 2D:

- когда `zoom` становится меньше порога (`ZOOM_THRESHOLD_IN = 1.7`), `EarthScene` вызывает `setMapCenterFromGlobe()`,
- `setMapCenterFromGlobe` использует `computeGlobeCenterLatLng(globeGroup)` и устанавливает:
  - `targetCenter` (используется для `MapView center`)
  - `reverseCenter` (используется для reverse геокодинга)

В результате центр карты в 2D — это “текущая середина” глобуса (та точка, куда направлена камера).

### 7.2. Reverse geocode: показ страны/региона/города

После изменения `reverseCenter` (координаты центра карты) выполняется запрос:

- `GET /api/geocode/reverse?lat=<lat>&lng=<lng>`

Ожидаемые поля ответа (минимум под форматирование):

- `display_name?: string`
- `address?: Record<string,string>` с ключами:
  - город: `city | town | village | hamlet`
  - регион: `state | region`
  - страна: `country`

Логика форматирования локали:

- строится массив `parts=[city, region, country].filter(Boolean)`
- если `parts` не пустой → `parts.join(', ')`
- иначе fallback на `display_name`
- иначе выводится `—`

### 7.3. Search/autocomplete: поиск населённого пункта через backend proxy

UI поведение:

- “автокомплит” активируется при длине запроса `q.length >= 2`.
- есть debounce:
  - задержка ~300ms после последнего ввода.
- при каждом изменении запроса (в MAP_2D) происходит запрос:
  - `GET /api/geocode/search?q=<query>`

Ожидаемые поля ответа:

- ответ прокси — это JSON-массив (Nominatim `format=json`), из которого UI читает:
  - `lat: string`
  - `lon: string`
  - `display_name?: string`
  - `type?: string`

После выбора пункта из списка:

- парсятся `lat/lon`
- `targetCenter` обновляется → `MapView` вызывает `setView([center.lat, center.lng], map.getZoom())`
- `reverseCenter` обновляется через `onCenterChanged`, и label страны/региона перерисовывается.

Поведение списка:

- UI ограничивает высоту выпадающего списка, если результатов больше 3:
  - `searchResults.length > 3` → появляется `maxHeight=120` и `overflowY=auto`

### 7.4. Отрисовка элементов в 2D (правила)

Легендарно (как минимум, для различения по типу/режиму), рендер должен следовать тем же группировкам, что и в 3D.

#### 7.4.1. Кабели

Для каждого элемента кабельного типа с валидным `path`:

- submarine:
  - `CABLE_FIBER` → solid polyline, цвет `#7aa2ff`
  - `CABLE_COPPER` → solid polyline, цвет `#f6c177`
- underground:
  - `CABLE_UNDERGROUND_FIBER` → dashed polyline, цвет `#4fd7ff`
  - `CABLE_UNDERGROUND_COPPER` → dashed polyline, цвет `#ffd28a`

Минимальные параметры визуализации:

- polyline weight: `2`
- opacity:
  - submarine: `0.9`
  - underground: рекомендуется `<=0.7` (визуально как в 3D)

#### 7.4.2. Узлы

Для каждого узла с `lat/lng` создаётся круговой маркер.

Рекомендуемое соответствие стилям 3D (для корректной легенды “как отличать”):

- `SATELLITE`:
  - цвет: `#9fe7ff`
  - radius: `3`
- остальные узлы (`SERVER/SWITCH/.../EQUIPMENT`):
  - цвет: взять из визуального mapping 3D (или упрощённо единым цветом, если пока нет полной палитры)
  - базовый radius: `4`

Текущая версия `MapView` может быть упрощенной (distinguish спутник vs прочее). Этот документ фиксирует целевую спецификацию легенды: различать все перечисленные типы.

## 8. Контракты `geocode-proxy`

В приложении “geocode / search / reverse” выполняются через backend proxy, чтобы:

- централизовать rate limit,
- кешировать результаты,
- изолировать клиент от внешних API.

### 8.1. `GET /api/geocode/search`

Параметры запроса:

- `q: string` (обязательный)

Валидация:

- `q.length < 2` → `400 { error: 'q too short' }`
- `q.length > 200` → `400 { error: 'q too long' }`
- rate limit (по IP): `60` запросов на окно `60_000ms` → `429 { error: 'rate limit exceeded' }`

Лимиты:

- прокси запрашивает upstream Nominatim с `limit=10`.

Кеш:

- cache key: `geocode:search:q:<trimmed>`

Ответ:

- `200 OK`, body: JSON-массив (Nominatim `format=json`), UI ожидает минимум:
  - `{ lat: string, lon: string, display_name?: string, type?: string, ... }[]`

### 8.2. `GET /api/geocode/reverse`

Параметры запроса:

- `lat: number` (обязательный)
- `lng: number` (обязательный)

Валидация:

- `lat/lng` должны быть числами (`Number.isFinite`)
- диапазоны:
  - `-90 <= lat <= 90`
  - `-180 <= lng <= 180`
- в противном случае:
  - `400 { error: 'invalid lat/lng' }` или `400 { error: 'lat/lng out of range' }`
- rate limit (по IP): `60` запросов на окно `60_000ms` → `429 { error: 'rate limit exceeded' }`

Кеш:

- cache key: `geocode:reverse:lat:<lat>:lng:<lng>`

Ответ:

- `200 OK`, body: JSON-объект (Nominatim reverse).
- UI использует минимум:
  - `display_name?: string`
  - `address?: { city?:string; town?:string; village?:string; hamlet?:string; state?:string; region?:string; country?:string; ... }`

### 8.3. `GET /api/geocode/nearby`

Назначение (для локальных подписей/UX вокруг центра):

- в текущей кодовой базе возвращается минимальный список “лейблов рядом с центром” через reverse geocoding.

Параметры запроса:

- `lat: number` (обязательный)
- `lng: number` (обязательный)
- `radiusKm: number` (обязательный, > 0)

Валидация:

- `400` если lat/lng невалидные,
- `400` если `radiusKm` невалидный или `radiusKm > 200` (чтобы предотвратить fan-out и explosion кеша),
- `429` при rate limit:
  - `30` запросов на окно `60_000ms`.

Кеш:

- cache key: `geocode:nearby:lat:<lat>:lng:<lng>:r:<radiusKm>`

Ответ:

- `200 OK`, body: массив `NearbyLabel[]`
- `NearbyLabel` минимум:
  - `lat: string`
  - `lon: string`
  - `display_name?: string`
  - `type?: string`

Примечание по текущей реализации:

- сейчас ответ всегда содержит массив из 1 элемента: `[ reverse(label) ]`.

## 9. Легенда: как отличать элементы

Ниже — “читабельные признаки” для пользователя на 3D и (целевой) на 2D.

### 9.1. Отличать submarine vs underground (кабели)

- Underground:
  - тип: `CABLE_UNDERGROUND_*`
  - стиль: пунктирная линия
  - слой: underground рисуется на `radius=0.992` и через `depthTest=false` (в 3D)
- Submarine:
  - тип: `CABLE_*` (не underground)
  - стиль: сплошная линия
  - слой: submarine рисуется на `radius=1.001` (в 3D)

Цвет и материал:

- Fiber:
  - submarine: `#7aa2ff` (solid)
  - underground: `#4fd7ff` (dashed)
- Copper:
  - submarine: `#f6c177` (solid)
  - underground: `#ffd28a` (dashed)

### 9.2. Отличать типы узлов (провайдеры/сервера/БС/коммутаторы/мультиплексоры/демультиплексоры/регенераторы/модемы)

В 3D различение идёт по:

- цвету (`nodeVisuals.color`)
- размеру сферы (`nodeVisuals.size`)
- emissive-подсветке (`nodeVisuals.emissive`)

Рекомендуемая легенда для 2D (если расширить отрисовку до полной палитры):

- `SERVER` — color `#3ddc97`
- `SWITCH` — color `#f6c177`
- `MULTIPLEXER` — color `#e6a7ff`
- `DEMULTIPLEXER` — color `#b36cff`
- `REGENERATOR` — color `#7df1ff`
- `MODEM` — color `#ff7d7d`
- `BASE_STATION` — color `#ffc3a0`
- `SATELLITE` — color `#9fe7ff` (часто отдельно из-за высоты/радиуса)
- `EQUIPMENT` — color `#ffffff`

### 9.3. Локальные подписи (3D)

Если пользователь приблизил сцену:

- подписи отображаются только для элементов вокруг текущего центра экрана,
- чем больше zoom — тем больше “угловой радиус” видимости подписи.

Это помогает читать карту без “обвеса” текста по всей Земле.

