# Данные сети, источники и модель предметной области

Документ фиксирует **что реально делает приложение сейчас** и **чем это отличается** от полной картины интернета и телеком-инфраструктуры. Нужен для диплома, ревью и дальнейшего наполнения БД.

## 1. Откуда берутся линии и узлы на карте

| Слой | Реализация |
|------|------------|
| API | `GET /api/network` читает **`NetworkProvider`** и **`NetworkElement`** из PostgreSQL (Prisma). |
| Сид | `prisma/seed.mjs`: спутник (демо) + реальные underground cables и `BASE_STATION` из датасетов (data.gov.au + OpenStreetMap); `sourceUrl` у демо-провайдера — заглушка. |
| Импорт кабелей | Подводные кабели — скрипт `npm run scripts:sync-cables` (Open Undersea Cable Map GeoJSON) — **ручной запуск**; авто-подгрузки при старте приложения **нет**. ITU/RIPE/BGP — по-прежнему вне scope. |

**Вывод:** визуализация корректна **как слой отображения данных из БД**, но **не** «все официальные данные мира» — их нужно **осознанно импортировать** с учётом лицензий.

## 1.1 Требование UX: “информация из метаданных”, а не “вшитые источники”

Для UX/Globe phase при отображении кабелей/узлов:

- карточка/список должны использовать фактические поля из БД:
  - тип элемента из `NetworkElement.type`,
  - provider-идентификатор/описания из связанного `NetworkProvider`,
  - дополнительные свойства — из `NetworkElement.metadata`.
- UI не должен “дополнять” данные “официальными” справками, если такие значения не были импортированы в `metadata`/БД; если нужны новые поля — они должны быть добавлены через next import (и зафиксированы в `docs/network-data-and-sources.md` с учётом лицензии).

## 2. Как устроен интернет (кратко) и что из этого в модели

Реальный интернет — это **иерархия** и **много технологий**:

- **Глобальные и региональные провайдеры (Tier 1/2/3)**, пиринг, IXPs.
- **Магистрали:** наземные и **подводные (submarine)** ВОЛС, иногда спутники; на суше — ВОЛС/медь/радио.
- **Оборудование (не исчерпывающе):** маршрутизаторы, L2/L3-коммутаторы, DWDM-мультиплексоры, OLT/ONT, модемы/трансиверы, **репитеры/регенераторы** на длинных ВОЛС, станции питания, дата-центры (серверы, стойки), базовые станции сотовой связи, антенны и т.д.

В схеме Prisma сейчас **минимальный** enum `NetworkElementType` (ровно **18** значений):

- кабели: `CABLE_COPPER`, `CABLE_FIBER`, `CABLE_UNDERGROUND_COPPER`, `CABLE_UNDERGROUND_FIBER`;
- узлы/оборудование: `PROVIDER`, `SERVER`, `SWITCH`, `MULTIPLEXER`, `DEMULTIPLEXER`, `REGENERATOR`, `MODEM`, `BASE_STATION`, `SATELLITE`, `EQUIPMENT`;
- офлайн: `MESH_RELAY`, `SMS_GATEWAY`, `VSAT_TERMINAL`, `OFFLINE_QUEUE`.

Отдельные «топологические» и узкоспециализированные типы (BRAS, OLT, воздушный/внутриобъектный кабель и т.п.) **не** входят в enum — это осознанное упрощение. Детали предметной области можно класть в **`metadata` (JSON)** или расширять enum отдельной миграцией, если понадобится.

## 3. Официальные и открытые источники данных (для наполнения, не «вшито в код»)

Ниже — типичные **отправные точки** для проектировщика; перед импортом проверяйте **лицензию и условия использования** каждого датасета.

| Тема | Примеры источников / заметки |
|------|------------------------------|
| Подводные кабели (карты, исследования) | TeleGeography Submarine Cable Map — часто используют как отраслевой ориентир; **условия данных** нужно читать на сайте / в API. Открытые зеркала/парсеры на GitHub не отменяют лицензию первоисточника. |
| Открытые наборы / сообщество | Репозитории вроде *open undersea cable map* (GitHub) — смотреть `LICENSE` в репозитории. |
| Гос. и геопорталы | Например, слои кабелей у NOAA (США) и др. — удобно для **геометрии**, не всегда для «бизнес-топологии» интернета. |
| Интернет-топология (AS-level) | Проекты и данные CAIDA, RIPE RIS, RouteViews — **другой масштаб** (автономные системы, BGP), не физические кабели 1:1. |

**Практический путь для проекта:** выбрать **один** датасет с ясной лицензией → скрипт импорта в `NetworkElement` (полилинии в `path`, точки в `lat`/`lng`) → указать `NetworkProvider.sourceUrl` и при необходимости поле `sourceId` для дедупликации.

## 4. Импорт подводных кабелей (реализовано)

Скрипт **`scripts/sync-submarine-cables.mjs`** загружает GeoJSON **Open Undersea Cable Map** (репозиторий [stevesong/open_undersea_cable_map](https://github.com/stevesong/open_undersea_cable_map), fork карты TeleGeography под **CC BY-NC-SA 3.0**).

- URL по умолчанию: `cable/cable-geo.json` из того репозитория.
- Переменная окружения **`SUBMARINE_CABLE_GEO_URL`** — подмена URL или локальный файл через **`--file path/to/cable-geo.json`**.
- Для полей **`metadata.year`**, **`metadata.countries`**, опционально **`metadata.rfs`** и **`metadata.officialUrl`** (из поля `url` в `cable/<id>.json`, если это валидный `http(s)` URL) скрипт по умолчанию запрашивает у того же источника JSON **`cable/<id>.json`** по одному разу на каждый уникальный `id` кабеля (сотни HTTP-запросов при полном импорте; есть повтор при 429/503/502). База URL: **`SUBMARINE_CABLE_DETAIL_BASE_URL`** (по умолчанию каталог `.../main/cable/` в репозитории Steve Song). Отключить детали: флаг **`--no-details`** (только геометрия и базовые поля из GeoJSON).
- В интерфейсе глобуса/2D блок «Источники» формируется для всех объектов (`cable` и `node`), если в данных есть валидные URL:
  - **Сайт проекта / оператора** — из `metadata.officialUrl` (или родственных полей metadata, если присутствуют),
  - **Источник провайдера** — из `NetworkProvider.sourceUrl` (если указан),
  - **Ссылка на датасет/запись** — по типу/метаданным (например, `cable/<id>.json` в GitHub для OUCM, permalink в OpenStreetMap, страница датасета data.gov.au, Celestrak),
  - **Поиск в Wikipedia (EN)** — для подводных кабелей как справочный поиск (не подтверждение трассы).
- Идемпотентность: `sourceId` вида `oucm-<feature_id>` (при нескольких сегментах — суффикс `-s1`, `-s2`, …).
- Провайдер в БД: `id = open-undersea-cable-map`, тип линии: `CABLE_FIBER`.

```bash
# проверка без записи в БД
node scripts/sync-submarine-cables.mjs --dry-run --limit 5

# импорт без запросов cable/<id>.json (без года/стран в metadata)
node scripts/sync-submarine-cables.mjs --no-details

# полный импорт (нужен DATABASE_URL)
npm run scripts:sync-cables
```

**Важно:** лицензия **CC BY-NC-SA 3.0** накладывает ограничения (в т.ч. некоммерческое использование). Для коммерческого продукта нужен другой датасет или согласование с правообладателем.

## 4.1. Импорт подземных кабелей (underground / terrestrial)

Скрипт **`scripts/sync-underground-cables.mjs`** загружает GeoJSON (WFS → GeoJSON) из датасета *Fibre Optic Cable* от **City of Gold Coast** на Data.gov.au:

- Dataset: https://data.gov.au/data/dataset/fibre-optic-cable
- WFS GeoJSON (по умолчанию в скрипте):
  `https://data.gov.au/geoserver/fibre-optic-cable/wfs?request=GetFeature&typeName=ckan_fa5452e4_7713_4c15_b647_ba0191a8c25c&outputFormat=json`
- Переменная окружения **`UNDERGROUND_CABLE_GEO_URL`** — подмена URL или локальный файл через **`--file path/to/underground.json`**.
- Провайдер в БД: `id = gold-coast-fibre-optic-cable`
- Тип линии: `CABLE_UNDERGROUND_FIBER`
- Идемпотентность: `sourceId` вида `gold-coast-fibre-optic-cable-<feature_id>` (при сегментах — суффикс `-s1`, `-s2`, …).

**Лицензия данных:** **Creative Commons Attribution 3.0 Australia (CC BY 3.0 AU)** с требованием атрибуции и оговоркой:
*“The information is provided to assist in field investigations. All locations, dimensions and depths shown are to be confirmed on site”.*

### 4.2. Импорт подземных медных кабелей (underground copper)

Для типа `CABLE_UNDERGROUND_COPPER` используется OpenStreetMap (Overpass API) с OSM wiki-ориентиром по маркировке телеком-кабелей под землей:

- теги (пример): `man_made=cable`, `location=underground`, `telecom:medium=copper`
- скрипт: **`scripts/sync-underground-copper-cables-osm.mjs`**
- провайдер (в БД): `NetworkProvider.id = osm-underground-telecom-cables-copper` (и отдельный `-local` для `LOCAL` scope)
- лицензия: **ODbL 1.0 (OpenStreetMap data © contributors)**, требуется атрибуция
- fallback (если OSM в вычисленном bbox не вернул ни одного подходящего way): опционально геометрию уже импортированных `CABLE_UNDERGROUND_FIBER` переиспользуют и reclassify в `CABLE_UNDERGROUND_COPPER` (тогда license note соответствует датасету Gold Coast / CC BY 3.0 AU, т.к. “медь” появляется как переразметка существующей геометрии).

OSM Telecoms / теги: [Telecoms - OpenStreetMap Wiki](https://wiki.openstreetmap.org/wiki/Telecoms) и [Key:cables](https://wiki.openstreetmap.org/wiki/Key:cables).

### 4.3. Импорт базовых станций (BASE_STATION)

Для `BASE_STATION` используются башни/мачты телекоммуникаций из OpenStreetMap:

- скрипт: **`scripts/sync-base-stations-osm.mjs`**
- извлекаются объекты с `man_made` уровня “communications_tower/telecommunication_tower/...” (точный набор тэгов — в скрипте)
- лицензия: **ODbL 1.0 (OpenStreetMap data © contributors)**
- bbox для OSM-запроса берётся из геометрии уже импортированных underground кабелей в рамках `scope`; в `prisma/seed.mjs` base stations запускаются после импорта underground fiber/copper (и поэтому обычно имеют “достаточную” область поиска).

### 4.4. Импорт спутников (SATELLITE) из TLE

Спутники создаются из TLE (Two-Line Elements) через библиотеку `satellite.js`:

- скрипт: **`scripts/sync-satellites-tle-celestrak.mjs`**
- источник TLE: Celestrak `gp.php` (параметр `GROUP` можно менять через `--group`)
- лицензия: проверять условия Celestrak на странице источника; в `NetworkProvider.licenseNote` фиксируется заметка “per Celestrak terms of use”

Ссылка на формат TLE: [Celestrak NORAD elements (gp.php)](https://celestrak.org/NORAD/elements/gp.php).

### 4.5. Узлы сети (PROVIDER/SERVER/SWITCH/...) как инференс-позиции

Типы `PROVIDER`, `SERVER`, `SWITCH`, `MULTIPLEXER`, `DEMULTIPLEXER`, `REGENERATOR`, `MODEM` в текущей реализации заполняются **инференсом**: позиции вычисляются из геометрии уже импортированных кабелей (`NetworkElement.path`), чтобы на глобусе были “узлы” для визуального слоя.

- скрипт: **`scripts/sync-derived-nodes-from-cables.mjs`**
- заметка: это не прямой импорт конкретного оборудования (отдельного open-датасета с координатами для каждого типа в текущем проекте может не быть), поэтому в `metadata` сохраняется пометка `dataset: derived-from-cables` и список `derivedFromCableSourceIds`.

## 5. Дальнейшие итерации

1. При необходимости — **импорт точек высадки** из `landing-point-geo.json` (отдельный скрипт / тип `EQUIPMENT` или точки).
2. **Документировать** в `NetworkProvider` дату выгрузки в `metadata` или в названии.
3. Расширить **enum** или `metadata` под DWDM, IXP и т.д. без ломки API.

## 6. Связь с модерацией и предложениями

Изменения сети могут идти через **предложения (proposals)** и модерацию: новые элементы должны быть **прослеживаемы** до источника (`sourceUrl`, `sourceId`), чтобы дипломно это выглядело как осознанное проектирование, а не «случайные линии».
