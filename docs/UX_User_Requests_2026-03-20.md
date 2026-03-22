# UX User Requests (2026-03-20)

Этот документ фиксирует конкретные пользовательские задачи на дату `2026-03-20` и предназначен для передачи разложенных работ агентам по секциям **A–G**.

## Точно описанные пользовательские задачи
- navigation: remove duplicate Propose/Предложить and remove Kabuli page
- back navigation
- cabinet username edit
- brighten Earth
- add 3D labels for countries/waters/cities
- show missing network elements including underground cables and nodes
- 3D->2D transition center based on current globe position
- fix 2D zoom
- top-left location label
- implement search for settlements

## Key files (ориентиры для затронутых мест)
- `src/components/HomePage.tsx`
- `src/app/cabinet/page.tsx`
- `src/app/api/profile/username/route.ts`
- `src/components/EarthScene.tsx`
- `src/components/MapView.tsx`
- `src/app/predlozhit/page.tsx`
- `src/app/cables/page.tsx`
- `scripts/sync-underground-cables.mjs`
- `scripts/sync-submarine-cables.mjs`
- (и возможные близкие sync/import scripts, если используются для underground/submarine кабелей)

## Универсальный промпт для агентов (copy-paste)
```txt
Ты работаешь по документу: docs/UX_User_Requests_2026-03-20.md.

Задачи внизу разбиты по секциям A–G.
1) Прочитай этот файл целиком.
2) Найди в документе свою секцию по букве A–G (ориентируйся на маппинг роль→буква в этом файле).
3) Реализуй ТОЛЬКО свою секцию: не правь чужие зоны без согласования координатора.
4) Перед правками: коротко перечисли, какие файлы затронешь (опираясь на "Key files" вверху документа).
5) После правок выполни `npm run lint` и `npm run build`.
6) Зафиксируй результат в `DEVELOPMENT_JOURNAL.md`: что сделано и какие файлы изменены.

Важно: не добавляй/не удаляй чужие маршруты и API-контракты без явной задачи в своей секции.
```

## Маппинг букв A–G (для этого документа)
- **A**: RefactorGuardianAgent
- **B**: ArchitectAgent
- **C**: Web3SolanaAgent
- **D**: ThreeLeafletAgent
- **E**: BackendAPIAgent
- **F**: FrontendAgent
- **G**: DocsEditorAgent / TestingCIAgent

## Какие буквы НЕ требуются (координатору)
В рамках этих UX-запросов **не нужно** привлекать агента **C (Web3SolanaAgent)**, если только в процессе разработки не всплывёт зависимость от Phantom/Wallet-UX.

Если появится необходимость (например, “cabinet username edit” требует изменений авторизации/подписи), координатор должен явно разрешить пересмотр и включение C.

---

## A) RefactorGuardianAgent (preflight / инварианты)
### Responsibilities
- Провести preflight по целостности маршрутов и UI-навигатора: убедиться, что после удаления duplicate `Propose/Предложить` и `Kabuli page` не остаётся битых ссылок.
- Защитить инварианты переключения режимов `3D <-> 2D` и синхронизации зума, чтобы изменения в `EarthScene`/`MapView` не ломали view-mode пороги.
- Проследить, что “show missing network elements including underground cables and nodes” не приводит к падениям рендера при пустых/частичных данных.
- Проверить, что “cabinet username edit” сохраняет валидацию/авторизацию по существующим правилам (без изменения контракта роутов вне своей зоны, если только это не согласовано).

### Acceptance criteria
- `npm run lint` и `npm run build` проходят.
- Нет ссылок в UI на удалённые страницы (`Propose/Предложить` дубликат и `Kabuli`), а back-навигация работает (возврат не приводит на 404/ошибку).
- Переход 3D->2D и обратный переход не ломают режим (user не теряет ожидаемый режим/зум).
- Рендер сетевых элементов устойчив: отсутствие underground/submarine данных не вызывает runtime errors.

---

## B) ArchitectAgent (решения по продукту / договоренности)
### Responsibilities
- Зафиксировать, как именно вычисляется “3D->2D transition center based on current globe position”:
  - источник центра (current globe center state / камера / raycast-free “середина глобуса”),
  - где хранится state (глобус -> карта),
  - как поведение согласовано с кликом на кнопку `2D` и режимом ручного зума.
- Согласовать правила отображения 3D подписей: “add 3D labels for countries/waters/cities” (радиус/порог zoom/условия видимости).
- Определить критерии “show missing network elements including underground cables and nodes”:
  - какие сущности считаются underground vs submarine,
  - какие узлы должны визуализироваться,
  - как это отображается в 3D и в 2D.
- Определить UX для “top-left location label” и “implement search for settlements”:
  - какой reverse/search flow через backend proxy,
  - какая схема данных возвращается (минимальные поля для label/autocomplete),
  - поведение при ошибках/пустых результатах.

### Acceptance criteria
- Есть чёткое описание (в `DEVELOPMENT_JOURNAL.md` и/или релевантных docs) принятых договоренностей по центру 3D->2D, правилам видимости 3D подписей и контрактам для label/search.
- Реализация агентов согласуется с договорённостями; изменения не вводят breaking API-контракты без явной отметки.

---

## C) Web3SolanaAgent (кошелёк Phantom)
### Responsibilities
- Не требуется для данного набора UX-запросов.

### Acceptance criteria
- Никаких изменений в кошельке/Phantom-авторизации не внесено (если только координатор явно не включил C из-за зависимости).

---

## D) ThreeLeafletAgent (глобус, карта, зум, сеть, 3D подписи)
### Responsibilities
- brighten Earth: скорректировать освещение/экспозицию/эмиссив/fallback так, чтобы “brighten Earth” не ухудшал читаемость кабелей и подписей.
- add 3D labels for countries/waters/cities:
  - реализовать отрисовку label-объектов в `src/components/EarthScene.tsx`,
  - ограничить видимость подписей по условию близости/текущего центра глобуса (и/или порогу zoom),
  - обновлять подписи при изменении центра/зум.
- show missing network elements including underground cables and nodes:
  - добавить визуализацию недостающих underground кабелей и узлов,
  - убедиться, что underground vs submarine различаются (материал/глубина/цвет/слой).
- 3D->2D transition center based on current globe position:
  - при переключении режимов центрировать `MapView` в “текущую середину глобуса” (там, куда смотрит камера / current globe position state).
- fix 2D zoom:
  - согласовать wheel/touchpad clamp и кнопки `+/-` (если они реализованы вокруг зума),
  - обеспечить стабильное поведение порогов, чтобы режим 3D/2D и зум не конфликтовали.

### Acceptance criteria
- Земля заметно “brighten” и читаемость кабелей/подписей не ухудшается.
- На 3D видны подписи “countries/waters/cities” в заданных условиях видимости, и подписи обновляются при изменениях центра/zoom.
- Визуально присутствуют недостающие underground кабели и nodes; submarine и underground различимы.
- Переход 3D->2D центрирует Leaflet по текущей “середине глобуса” (не по фиксированным координатам).
- 2D zoom не ломает UI: clamping/пороги стабильны, переключение режимов не сбрасывает зум неожиданно.

---

## E) BackendAPIAgent (роуты, geocode proxy, данные для сети и labels/search, profile username)
### Responsibilities
- cabinet username edit:
  - обеспечить корректную обработку `src/app/api/profile/username/route.ts` (валидация, авторизация, обновление имени в БД),
  - сохранить существующие DTO/контракт и правила ошибок/статусов.
- show missing network elements including underground cables and nodes:
  - обеспечить выдачу достаточных полей для визуализации underground кабелей и nodes (метаданные/тип/координаты/связи),
  - при необходимости расширить `GET /api/network` (или предоставить отдельный endpoint) без поломки клиентов.
- top-left location label:
  - реализовать backend proxy для reverse geocode (по lat/lng вернуть Country/Region/City или эквивалентные поля).
- implement search for settlements:
  - реализовать backend proxy autocomplete/search (по `q` вернуть топ N кандидатов для списка/автокомплита поселений),
  - убедиться, что recenter по выбору кандидата передаёт точные координаты на фронт.
- Geocode proxy:
  - rate limit + кэш согласно существующим правилам проекта (например `src/lib/rateLimit`), чтобы не сломать внешний провайдер.

### Acceptance criteria
- `POST/PUT` по `username` корректно обновляет username в cabinet и возвращает ожидаемые статусы/ошибки.
- Network endpoints отдают underground кабели и nodes (и нужные метаданные для различимости).
- Reverse geocode возвращает корректные поля для “top-left location label”.
- Search/autocomplete возвращает корректные кандидаты для “implement search for settlements”, и выбор кандидата реально recenter’ит 2D карту.
- Лимиты/кэш включены, нет прямого доступа к внешнему геокодеру из браузера.

---

## F) FrontendAgent (страницы, навигация, UI overlay: labels/search, 2D zoom controls, cabinet UI)
### Responsibilities
- navigation:
  - remove duplicate Propose/Предложить,
  - remove Kabuli page,
  - привести навигацию/меню к единственному источнику правды.
- back navigation:
  - реализовать back-навигацию так, чтобы возврат вёл на корректную предыдущую страницу/состояние (без 404).
- cabinet username edit:
  - обновить `src/app/cabinet/page.tsx` UI для редактирования username,
  - выполнить интеграцию с `src/app/api/profile/username/route.ts`.
- brighten Earth:
  - если требуется UI-уровень (параметры сцены/тонмаппинг), связать настройки с `src/components/EarthScene.tsx` (без дублирования логики ThreeLeafletAgent).
- 3D->2D transition center based on current globe position:
  - убедиться, что клик/переключение в 2D использует state/сигналы от `EarthScene` и корректно обновляет `MapView`.
- fix 2D zoom:
  - реализовать/починить 2D zoom UX (wheel/touchpad, кнопки `+/-`, clamp),
  - гарантировать, что “fix 2D zoom” не конфликтует с viewMode порогами.
- top-left location label:
  - добавить overlay слева сверху, который показывает текущую локацию (Country/Region/City) из reverse geocode.
- implement search for settlements:
  - добавить строку поиска поселений с автокомплитом,
  - при выборе кандидата вызвать recenter 2D карты на координаты кандидата.
- UI для сетевых элементов:
  - проверить/обновить отображение списка/деталей на странице `src/app/cables/page.tsx`, чтобы underground кабели и узлы были доступны для просмотра, если это предусмотрено общим UX.

### Acceptance criteria
- В приложении нет дубликата Propose/Предложить и удалена Kabuli page; навигация не ведёт на несуществующие страницы.
- Back-навигация возвращает пользователя в ожидаемое место/состояние без ошибок.
- В `cabinet` можно отредактировать username, и изменения отображаются корректно после сохранения.
- Earth “brighten” (за счёт связки с EarthScene).
- Переход 3D->2D центрирует MapView по текущему положению глобуса.
- 2D zoom стабильный и не “ломает” интерфейс.
- Слева сверху отображается “top-left location label”, обновляясь при recenter/transition.
- Search по поселениям работает: автокомплит показывает результаты, выбор кандидата recenter’ит карту.
- На `src/app/cables/page.tsx` отображаются необходимые сетевые элементы (в т.ч. underground кабели/узлы), если они существуют в данных.

---

## G) DocsEditorAgent / TestingCIAgent (документация, smoke-тесты, приемка)
### Responsibilities
- Документировать изменения UX и контрактов (насколько затронуты) в:
  - `README.md` и/или `docs/earth-visualization.md` (brighten Earth, 3D->2D центрирование, локальные подписи, label/search через backend proxy),
  - при необходимости дополнить чеклист UX.
- Описать эндпоинты и ожидаемые поля для reverse/search и выдачи network элементов (без раскрытия секретов).
- Smoke-тестирование ключевых сценариев:
  - 3D <-> 2D переход (центрирование по текущей “середине глобуса”),
  - 2D search/autocomplete и recenter,
  - reverse geocode для “top-left location label”,
  - render новых типов/underground кабелей и nodes.

### Acceptance criteria
- smoke-check сценариев из Responsibilities проходит без регрессий;
- `npm run lint` и `npm run build` проходят;
- обновлены документы/чеклист UX с описанием поведения:
  - “brighten Earth”,
  - “add 3D labels for countries/waters/cities”,
  - “3D->2D transition center based on current globe position”,
  - “fix 2D zoom”,
  - “top-left location label” и “implement search for settlements” (через backend proxy).

