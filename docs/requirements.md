# Требования (requirements)

## Функциональные требования

### Авторизация (Stage 1)
- Подключение Phantom wallet.
- Подпись сообщения пользователем (`signMessage`).
- Проверка подписи на сервере (`tweetnacl` + `bs58`).
- Upsert пользователя в БД по `pubkey` (unique).

### Визуализация (Stages 2–4)
- 3D глобус (Three.js): Земля (текстура/материал), управление камерой, UI-кнопки.
- 2D карта (Leaflet): тайлы через API-прокси, поиск места, reverse geocoding.
- Переход 3D ↔ 2D: по порогу приближения и/или по кнопке, с гистерезисом.
- 2D vs 3D (UX/Globe phase): авто-переключение по zoom не должно конфликтовать с ручным выбором режима.
  - Переход 3D -> 2D обязан **центрировать** Leaflet в текущую “середину” глобуса (куда “смотрит” камера / текущий center state).
  - Авто-переход 2D -> 3D (если разрешён) должен также уважать ручной выбор пользователя (опционально — запретить авто-возврат и делать возврат в 3D только кнопкой).
- Отображение элементов сети (кабели/узлы/спутники) и провайдеров.
- Читаемость Земли (UX/Globe phase): осветлить 3D-сцену (фон/тон/экспозиция/эмиссив-fallback), чтобы кабели/узлы оставались различимыми на любом материале глобуса.
- UX “информация о кабелях” (Globe phase):
  - Основной путь — список/карточка, данные берутся из `NetworkElement.metadata` (и связанных `provider`/типов узлов из БД/seed).
  - 3D-picking линий/кабелей как источник “деталей” — опционально и переносится на следующий этап; текущий MVP не должен блокировать список/карточку.
- Локальные подписи на 3D (UX/Globe phase): показывать подписи только в окрестности текущего центра глобуса (и/или при zoom-in), а не “всё сразу”.
- UX “границы/страны”:
  - В 2D — показывать границы через Leaflet-слой (доступно и читабельно).
  - В 3D — границы/страны не должны доминировать картину: при необходимости обеспечивать читаемость за счёт более светлой/мягкой сцены (осветление/тон-маппинг), а не за счёт тяжёлого 3D overlay.
- Подводные/подземные кабели (UX/Globe phase): различать submarine vs underground цветом/уровнем/глубиной, используя расширенные типы/флаги из БД (в текущем MVP — через `NetworkElement.type` + `NetworkElement.metadata` поля, установленные импортом; для underground требуется отдельный импорт/флаг).
- UX “легенда типов”:
  - На глобусе и в карте должен быть понятный способ различать типы элементов сети (`CABLE_*`, `BASE_STATION`, `SATELLITE`, `EQUIPMENT`) и провайдеров.
  - Стили/лейблы легенды должны опираться на данные из БД/seed (типы + `provider` + содержимое `metadata`), без “официальных” источников, захардкоженных в UI-код.
- 2D как Google/Yandex (UX/Globe phase):
  - показывать текущую локацию (Country/Region/City) слева сверху через reverse geocode для центра карты;
  - добавлять строку поиска с автокомплитом: кандидаты приходят через backend proxy (эндпоинты `/api/geocode/search` и `/api/geocode/reverse`), внешнее geocoding не выполнять из браузера напрямую;
  - при выборе результата делать recenter карты в выбранную точку.

### Режим “Propose” (Stage 5, без chain)
- В БД существуют сущности **Proposal** и **ChangeAction** (см. `prisma/schema.prisma` и `docs/stage5plus.md`).
- Пользователь создаёт **предложение изменения** (Proposal), которое хранится в таблице `Proposal`.
- Базовый минимум Stage 5 реализован через:
  - API `/api/proposals`:
    - `POST /api/proposals` — создание предложения в статусе `DRAFT` по `scope`, `authorPubkey`, опциональным `title`/`description`;
    - `GET /api/proposals` — просмотр списка предложений с фильтрами по `status` и `authorPubkey`;
    - `GET /api/proposals/:id` — просмотр одного предложения.
  - Базовый UI на `/propose`, который использует Phantom‑auth для получения `authorPubkey` (через `useAuthorPubkey`).
- Логика статусов и действий Proposal/ChangeAction (создание/редактирование списка ChangeActions, submit/accept/reject/apply) описана в `docs/stage5plus.md` и будет расширяться на последующих стадиях (6–7).
- Идентификация автора предложения использует тот же Phantom‑auth поток, что и `POST /api/auth/verify`: фронтенд берёт текущий `publicKey` Phantom‑кошелька и передаёт его как `authorPubkey` в вызовы `/api/proposals/*`.
- На Stage 5 minimum перевод предложения в `SUBMITTED` через API/UI пока не реализован; эндпоинт Stage 6 требует, чтобы `Proposal.status` в БД уже был `SUBMITTED`.

### Подписи/chain (Stage 6)
- Любое `SUBMITTED` предложение фиксируется off-chain подписью канонического `contentHash`.
- На Stage 6 выполняется on-chain фиксация этого же `contentHash` через Solana транзакцию (на этом шаге — Memo placeholder); полная Anchor-интеграция ожидается позже.
- Минимальный кейс Stage 5 (без редактора `ChangeAction`): считается, что `actions = []`, поэтому `contentHash` зависит только от детерминированных `proposalFields`.
- Frontend формирует `contentHash` в том же каноническом формате, затем подписывает:
  - `message = "diploma-z96a propose:" + contentHash`
  - подпись передаётся base58 в запрос on-chain endpoint как `signature`.

### API (Stage 6 contract)
- `POST /api/proposals/:id/submit`
  - Request body: `{ signature: string, contentHash?: string }`
  - Response: `{ txSignature: string }`
  - Backend:
    - принимает только предложения со статусом `Proposal.status === "SUBMITTED"`;
    - вычисляет `contentHash` на сервере по текущим данным `Proposal` и списку `ChangeAction` (для Stage 5 minimum `actions = []`);
    - проверяет:
      - согласованность с уже сохранённым `Proposal.contentHash` (если он задан),
      - согласованность с `contentHash` из запроса (если он передан);
    - проверяет подпись автора `diploma-z96a propose:<computedContentHash>` по `Proposal.authorPubkey`;
    - если `Proposal.onChainTxSignature` и `Proposal.onChainSubmittedAt` уже заполнены — возвращает существующий `txSignature` без повторной отправки;
    - иначе отправляет:
      - в `dev`/`test` (`NODE_ENV !== "production"`) — dev/mock `txSignature` (формат `dev-tx-...`);
      - в `production` — Solana Memo-транзакцию (Memo placeholder) и возвращает реальный `txSignature`;
    - сохраняет в БД: `contentHash`, `signature`, `onChainTxSignature`, `onChainSubmittedAt`.

### История/откат (Stage 7)
- Каждое применённое действие записывается в историю (Audit/History).
- Откат реализуется как набор “обратных действий” (reverse actions) либо через снапшоты.

### API (инварианты)
- `GET /api/network?scope=GLOBAL|LOCAL&bbox=minLat,minLng,maxLat,maxLng`
- `POST /api/auth/verify` и `POST /api/auth`
- `GET /api/tile?z=&x=&y=&source=osm|...`
- `GET /api/geocode/search?q=...`
- `GET /api/geocode/reverse?lat=&lng=...`

## Нефункциональные требования
- Производительность: минимизация re-render, ограничение количества объектов на сцене, кэширование тайлов.
- Безопасность: валидация входных параметров API, разумные timeouts, ограничение внешних прокси вызовов.
- UX: понятные панели управления, стабильные переходы 3D/2D, предсказуемое поведение карты.

### Security + observability (Stage 10)

- Публичные API-контракты Stage 5-8 остаются стабильными (см. `PROJECT_STAGES.md`).
- Документация security/ops для production-depth должна быть синхронизирована и исполнима copy-paste:
  - `docs/operations.md` (runbooks, env matrix, incident flow),
  - `docs/secrets-policy.md` (secret handling, no leaks),
  - `docs/release-hardening.md` (GO/NO-GO + rollback readiness).
- Наблюдаемость минимум:
  - health-check endpoint `GET /api/health`;
  - структурированные API-метрики в логах (`api_metric`) для ключевых mutation/health endpoint'ов;
  - документированные rate-limit политики для публичных proxy и proposal mutation endpoints.

