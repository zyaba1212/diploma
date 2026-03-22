# UX User Requests (2026-03-20) v2 — site2d3d + satellite

Этот документ фиксирует конкретные пользовательские задачи на дату `2026-03-20` для передачи работ по секциям **A–G** (см. промпт ниже).

Требование v2: обновить текущие UX-инварианты и зафиксировать новый site-skeleton (Home/About/header) вместе с корректным 2D/3D переключением и новой визуализацией `SATELLITE`.

## Точно описанные пользовательские задачи (v2)

1) **Убрать auto-переход в 2D через zoom**
- Удалить логику, которая переключает режим `3D -> 2D` автоматически по порогу zoom.
- В 2D сеть должна оставаться доступной для инспекции (без “морганий” и скрытия 2D).

2) **Точное соответствие центров при переходе 2D <-> 3D**
- Переход `3D -> 2D` должен центрировать Leaflet в точке, которая соответствует текущему “центру” глобуса (туда смотрит камера / current globe position state).
- Переход `2D -> 3D` должен **центрировать 3D так, чтобы точка в текущем center Leaflet оказалась на том же месте фронта** (визуально “ровно там, где пользователь сейчас находится” на карте).

3) **Новый site skeleton**
- `Home` описывает проект.
- `About` показывает автора: `Zybliyenko` (и кратко что делает проект).
- Кнопка в верхнем хедере: `Глобальная сеть` ведёт на страницу `/global-network` (страницу с 3D/2D сетью).

4) **Убрать left-top навигационную панель**
- Удалить левый верхний блок навигации (панель с ссылками), оставив только новый верхний хедер.

5) **Добавить только центрированный top-link `Главная`**
- В верхнем хедере по центру показать ссылку/текст `Главная`.

6) **2D инспекция сети без zoom-based переходов**
- В 2D отображение сети не должно скрываться из-за zoom/порогов.

7) **2D user location notification + settlement search dropdown**
- В 2D показать уведомление/лейбл о текущей локации пользователя (“Вы здесь” или эквивалент) после получения geolocation (с состояниями loading/error).
- Реализовать settlement search dropdown:
  - список с прокруткой,
  - recenter карты при выборе пункта,
  - закрытие dropdown после выбора,
  - устойчивые UI-состояния при вводе/загрузке/ошибках.

8) **Satellite appearance**
- `SATELLITE` должен рендериться как **3D satellite model**, а не как sphere/маркер-шар.

9) **Сеть: underground cables + base stations**
- Убедиться, что сеть в данных включает:
  - underground cables (не только submarine),
  - base stations.
- Эти элементы должны визуально отличаться и отображаться в 3D и 2D.

## Key files (ориентиры для затронутых мест)

- `src/components/EarthScene.tsx` (2D/3D переходы, overlay, рендер сетевых элементов в 3D, текущая отрисовка `SATELLITE`)
- `src/components/MapView.tsx` (отрисовка сети в 2D, recenter/center-change)
- `src/components/HomePage.tsx` (legacy-объединённый layout; после v2 должен быть изменён/разделён под новый site-skeleton и/или убрана навигация)
- `src/app/page.tsx` (Home — вместо EarthScene показать описание проекта)
- `src/app/global-network/page.tsx` (страница “Глобальная сеть” с EarthScene / сетью)
- `src/app/about/page.tsx` (новая страница About)
- `src/app/layout.tsx` (подключение общего хедера для всех страниц)
- `src/components/AuthBlock.tsx` (при необходимости: размещение/з-index внутри нового header/layout)

Backend/контракты, которые используются для location/search и сети:
- `src/app/api/network/route.ts`
- `src/app/api/geocode/reverse/route.ts`
- `src/app/api/geocode/search/route.ts`

Импорт/синхронизация (чтобы в данных были underground cables и base stations):
- `scripts/sync-underground-cables.mjs`
- `scripts/sync-underground-copper-cables-osm.mjs`
- `scripts/sync-submarine-cables.mjs`
- `scripts/sync-base-stations-osm.mjs`
- `scripts/sync-derived-nodes-from-cables.mjs`
- `scripts/sync-satellites.mjs` и/или `scripts/sync-satellites-tle-celestrak.mjs`

Типы/сущности:
- `src/lib/types.ts` (включает `CABLE_UNDERGROUND_*`, `BASE_STATION`, `SATELLITE`)

## Универсальный промпт для агентов (copy-paste)

```txt
Ты работаешь по документу: docs/UX_User_Requests_2026-03-20_v2_site2d3d_satellite.md.

Задачи внизу разбиты по секциям A–G.
1) Прочитай этот файл целиком.
2) Найди в документе свою секцию по букве A–G (ориентируйся на маппинг роль→буква в этом файле).
3) Реализуй ТОЛЬКО свою секцию: не правь чужие зоны без согласования координатора.
4) Перед правками: коротко перечисли, какие файлы затронешь (опираясь на "Key files" вверху документа).
5) После правок выполни `npm run lint` и `npm run build`.
6) Зафиксируй результат в `DEVELOPMENT_JOURNAL.md`: что сделано и какие файлы изменены.
7) Важно: не ломай существующие API-контракты без явной отметки breaking change.
8) Важно: не редактируй plan-файлы (например, `docs/COORDINATOR_DEV_PLAN.md`, `docs/ARCHITECT_CHAT_PLAN.md`).
```

## Маппинг букв A–G (для этого документа)

- **A**: RefactorGuardianAgent
- **B**: ArchitectAgent
- **C**: Web3SolanaAgent
- **D**: ThreeLeafletAgent
- **E**: FrontendAgent
- **F**: BackendAPIAgent и ScriptsImportAgent
- **G**: DocsEditorAgent и TestingCIAgent

## Какие буквы НЕ требуются (координатору)

В рамках этого набора UX-запросов агент **C (Web3SolanaAgent)** не требуется, если только миграции layout/header не затронут wallet/Phantom-UX и не появится явная блокирующая зависимость.

---

## A) RefactorGuardianAgent (preflight / инварианты)

### Responsibilities

- Проверить, что после удаления left-top навигации и перехода на новый header не остаётся битых ссылок.
- Проверить инварианты режима:
  - в `2D` не происходит автоматического `3D -> 2D`/`2D -> 3D` из-за zoom-порогов;
  - ручное переключение (кнопки/UX-элементы) остаётся стабильным.
- Проверить, что transition `2D <-> 3D` действительно использует текущие позиции/centers и не приводит к “скачкам” в других направлениях.
- Проверить устойчивость при:
  - запрете geolocation,
  - пустых результатах settlement search,
  - частично заполненной сети (например, если в БД ещё не все underground/base station данные).
- Проверить, что спутниковая визуализация не ломает рендер (ошибка загрузки модели должна деградировать без падения).

### Acceptance criteria

- `npm run lint` и `npm run build` проходят.
- В UI нет ссылок на удалённые маршруты; `Глобальная сеть` ведёт на страницу EarthScene.
- Нет zoom-based авто-переходов в 2D; 2D остаётся доступной для инспекции.
- Геолокация/поиск/рекентрирование не падают при ошибках и возвращают корректные состояния.

---

## B) ArchitectAgent (решения по продукту / договоренности)

### Responsibilities

- Зафиксировать UX-контракты:
  - точное определение “центра” при переходах `3D -> 2D` и `2D -> 3D`,
  - источники state для leaflet center и globe “front-face center”.
- Предложить алгоритм/математику для `2D -> 3D`:
  - по текущему `lat/lng` (Leaflet center) вычислить поворот/ориентацию `globeGroup`, чтобы выбранная точка оказалась в том же “центре экрана” в 3D.
- Договориться о site-skeleton:
  - маршруты `Home`, `About`, `EarthScene` (страница “Глобальная сеть”),
  - спецификация хедера: `Главная` по центру и кнопка `Глобальная сеть` в верхней шапке.
- Определить специфику satellite model:
  - какой формат модели (например, `glb`),
  - масштаб/ориентация/анимация (если применимо),
  - как привязывать модель к `SATELLITE` элементам (какие поля нужны: lat/lng/altitude и возможная ориентация).
- Договориться о требованиях к данным:
  - какие underground cable типы обязательно должны приходить в `GET /api/network`,
  - что `BASE_STATION` и `SATELLITE` должны быть включены в сеть на уровне импорта/синхронизации.

### Acceptance criteria

- В `DEVELOPMENT_JOURNAL.md` и/или релевантных docs зафиксированы принятые договоренности:
  - алгоритм точного центрирования 2D<->3D,
  - route/UX спецификация нового header+Home+About,
  - требования к satellite model и данным для её отображения.

---

## C) Web3SolanaAgent (кошелёк Phantom)

### Responsibilities

- Проверить, что перенос/перестановка UI (header/layout) не ломает connect/disconnect.
- Если в новом layout меняется размещение `AuthBlock`, убедиться, что `pointer-events` и `z-index` не мешают работе wallet.

### Acceptance criteria

- Нет регрессий Phantom connect/disconnect на новых страницах.

---

## D) ThreeLeafletAgent (глобус, карта, зум, сеть, 3D подписи)

### Responsibilities

- **Убрать zoom-based auto-transition в 2D**
  - удалить логику, которая переключает `viewMode` по порогу zoom.
  - подтвердить, что переключение `3D <-> 2D` выполняется только явным действием пользователя (кнопки/UX элементы).
- **Точное центрирование `2D <-> 3D`**
  - `3D -> 2D`: Leaflet center вычислять из текущей позиции/ориентации глобуса (current globe position state), чтобы соответствие было 1:1 по визуальному центру.
  - `2D -> 3D`: по Leaflet center lat/lng обновлять `globeGroup` (или эквивалентный state) так, чтобы выбранная точка в 3D оказалась в “центре” камеры.
- **Satellite appearance**
  - заменить маркер-шар для `SATELLITE` на 3D satellite model.
  - обеспечить подгрузку модели (с кэшированием) и корректный fallback при ошибке.
  - сохранить привязку к координатам `SATELLITE` (lat/lng) и (если требуется моделью) altitude/масштаб.
- **Underground cables + base stations**
  - убедиться, что в рендере 3D/2D используются типы underground кабелей (`CABLE_UNDERGROUND_*`) и `BASE_STATION`.
  - обеспечить визуальное различие submarine vs underground (материал/стиль/линии).
- **2D user location + recenter**
  - поддержать UI-интеграцию для “Вы здесь” и recenter на выбранную точку пользователя/settlement:
    - предоставить корректный callback/метод, который обновляет Leaflet center (и при необходимости globe state через transition).

### Acceptance criteria

- Нет автоматического перехода `3D -> 2D` по zoom.
- При переключении `2D -> 3D` выбранный Leaflet center оказывается в визуальном центре 3D сцены (без “уезда” в сторону).
- `SATELLITE` визуально представлен 3D-моделью (не sphere), без падений при ошибках загрузки.
- В сети видны underground кабели и base stations в 3D и 2D, и они отличимы от submarine.

---

## E) FrontendAgent (layout, страницы, header, 2D overlay UI)

### Responsibilities

- **Новый site skeleton**
  - `Home` (`src/app/page.tsx`): показать описание проекта вместо прямого EarthScene.
  - `About` (`src/app/about/page.tsx`): отобразить автора `Zybliyenko` и краткую информацию.
  - `EarthScene page` (страница “Глобальная сеть”): гарантировать, что кнопка в header ведёт на страницу с текущим EarthScene (см. `src/app/global-network/page.tsx`).
- **Удалить left-top навигационную панель**
  - убрать панель навигации из `src/components/HomePage.tsx` (или из компонента, где остаётся EarthScene overlay).
  - в новом UX оставить только top header.
- **Добавить только центрированный top-link `Главная`**
  - в хедере: `Главная` строго по центру.
  - убрать любые другие top/side навигационные панели (кроме кнопки `Глобальная сеть` как навигации на EarthScene).
- **2D user location notification**
  - реализовать получение геолокации (`navigator.geolocation`) в 2D режиме;
  - показать уведомление/лейбл (“Вы здесь”), а при ошибке — понятное сообщение/статус.
- **Settlement search dropdown с прокруткой и recenter**
  - settlement search dropdown:
    - список с scroll (по фиксированной `max-height`),
    - стабильное поведение при частых вводах,
    - recenter карты при выборе элемента,
    - dropdown закрывается при выборе,
    - UI показывает “Загрузка…”/“Ничего не найдено”/ошибки.
- **Размещение UI поверх 2D карты**
  - гарантировать, что overlay (location/search) не перекрывается header’ом и не блокирует взаимодействие карты там, где это запрещено.

### Acceptance criteria

- `Home` и `About` корректно отображаются по своим маршрутам.
- В header есть:
  - центрированный `Главная`,
  - кнопка `Глобальная сеть` ведёт на страницу EarthScene.
- Нет left-top панели навигации.
- В 2D:
  - показывается notification о location пользователя (или корректная ошибка при запрете),
  - settlement search dropdown имеет scroll,
  - выбор элемента recenter’ит карту.

---

## F) BackendAPIAgent + ScriptsImportAgent (данные, эндпоинты, импорт)

### Responsibilities

- **Сеть: underground + base stations**
  - убедиться, что импорт/синхронизация underground кабелей и base stations реально попадает в БД и отдаётся фронту через `GET /api/network`.
  - при необходимости обновить/добавить импорт/преобразования для underground и derived nodes.
- **SATELLITE данные для 3D-модели**
  - обеспечить, чтобы `SATELLITE` элементы содержали данные, необходимые для визуализации:
    - минимум: `lat/lng` (и `altitude` если модель требует масштаб/позиционирование),
    - при наличии: orientation/metadata для корректной ориентации модели.
- **Geocode proxy для user location + settlement search**
  - проверить, что текущие endpoints:
    - `GET /api/geocode/reverse?lat&lng`,
    - `GET /api/geocode/search?q`
    покрывают UI-логику (формат возвращаемых полей).
  - при необходимости адаптировать лимит результатов или формат данных под dropdown с прокруткой.
- **Не ломать контракт**
  - не менять shape ответа API без синхронизации с frontend.

### Acceptance criteria

- `GET /api/network` возвращает underground cables и `BASE_STATION` вместе с остальными элементами.
- `SATELLITE` элементы содержат нужные поля для 3D-модели (и нет runtime-несовместимостей).
- Geocode reverse/search стабильно отдают данные для location label и settlement search (без утечек внешнего API из браузера).

---

## G) DocsEditorAgent / TestingCIAgent (документация, smoke-тесты, приемка)

### Responsibilities

- Описать обновления UX в документации:
  - новый site skeleton (Home/About/header и маршрут “Глобальная сеть”),
  - поведение переключения `3D <-> 2D` без zoom-based auto transition,
  - правила точного центрирования (как проверить визуально),
  - поведение 2D user location notification и settlement search dropdown,
  - что `SATELLITE` теперь представлен 3D-моделью,
  - что сеть включает underground cables и base stations.
- Если в проекте есть UX/earth-visualization docs — обновить соответствующие секции или чеклист.
- Smoke-тестирование ключевых сценариев:
  - ручное переключение 3D<->2D при разных zoom без авто-переходов,
  - совпадение визуальных центров на переходах 2D -> 3D,
  - геолокация: loading -> label / error state,
  - settlement search: ввод -> scroll -> выбор -> recenter,
  - render: underground cables + base stations,
  - render: `SATELLITE` 3D модель (и fallback при недоступности модели).
- Manual (всегда вручную): убедиться, что `SATELLITE` выглядит именно как 3D satellite model (не “шарик”), т.к. полная визуальная проверка автоматизацией здесь ограничена.
- Проверить `npm run lint` и `npm run build`.

### Acceptance criteria

- Все smoke-сценарии проходят без регрессий.
- Документированы необходимые изменения UX/контрактов.
- `npm run lint` и `npm run build` проходят.

