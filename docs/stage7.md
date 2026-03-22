# Stage 7: History + Rollback (data model + API contract)

## Цель Stage 7

В Stage 7 добавляется:
- управление `ChangeAction` внутри `Proposal` (минимум для сценария apply),
- endpoint’ы `apply` и `rollback`,
- модель `HistoryEntry` для аудита и восстановления состояния сети при откате.

## Инварианты Stage 5/6

- Контракты уже существующих endpoints Stage 5 (`POST/GET /api/proposals`, `GET /api/proposals/:id`) не меняем.
- Stage 6 submission facts (`Proposal.contentHash`, `Proposal.signature`, `onChainTxSignature`, `onChainSubmittedAt`) остаются единственным каноническим источником привязки предложения к `contentHash`.
- Apply/rollback меняют только “активную” модель сети (`NetworkProvider`/`NetworkElement`), а историю для rollback храним в `HistoryEntry.diff`.

## Модель `HistoryEntry.diff` (v1, фактический backend-формат)

В текущей реализации Stage 7 backend rollback парсит `latest.diff` и **ожидает `diff.kind`**.

`HistoryEntry.diff` — JSON-объект вида `ChangeActionDiff` (по одному diff на каждую отдельную `ChangeAction`, т.к. backend создаёт `HistoryEntry` **внутри** цикла по actions):

### 1) CREATE

```json
{
  "kind": "CREATE",
  "createdElementId": "<NetworkElement.id>"
}
```

Rollback для `CREATE`: удаляет `NetworkElement` с `id = createdElementId`.

### 2) UPDATE

```json
{
  "kind": "UPDATE",
  "targetElementId": "<NetworkElement.id>",
  "beforeElement": {
    "id": "<NetworkElement.id>",
    "scope": "GLOBAL|LOCAL",
    "type": "<NetworkElementType>",
    "providerId": "<NetworkProvider.id>|null",
    "name": "<string|null>",
    "sourceId": "<string|null>",
    "lat": "<number|null>",
    "lng": "<number|null>",
    "altitude": "<number|null>",
    "path": "<Json|null>",
    "metadata": "<Json|null>"
  }
}
```

Rollback для `UPDATE`: восстанавливает `NetworkElement` полями из `beforeElement`.

### 3) DELETE

```json
{
  "kind": "DELETE",
  "targetElementId": "<NetworkElement.id>",
  "deletedElement": {
    "id": "<NetworkElement.id>",
    "scope": "GLOBAL|LOCAL",
    "type": "<NetworkElementType>",
    "providerId": "<NetworkProvider.id>|null",
    "name": "<string|null>",
    "sourceId": "<string|null>",
    "lat": "<number|null>",
    "lng": "<number|null>",
    "altitude": "<number|null>",
    "path": "<Json|null>",
    "metadata": "<Json|null>"
  }
}
```

Rollback для `DELETE`: создаёт `NetworkElement` с `id = deletedElement.id` и полями из `deletedElement`.

Важно:
- rollback откатывает **последнюю** `HistoryEntry` (latest по `appliedAt desc`), поэтому откат касается только одного diff.
- поле `diff` хранится как JSONB; в коде rollback допускается, что diff может прийти строкой и тогда парсится.

## ProposalStatus на Stage 7 (рекомендация для консистентности)

Текущая реализация backend Stage 7 (v1) использует следующие статусы:
- `POST /api/proposals/:id/apply`:
  - в production требует `Proposal.status === 'ACCEPTED'`;
  - в dev допускает `Proposal.status === 'SUBMITTED'` и после apply переводит его в `ACCEPTED`;
  - не переводит предложение в `APPLIED` (статус APPLIED/CANCELLED в коде пока не влияет на rollback gating).
- `POST /api/proposals/:id/rollback`:
  - в production требует `Proposal.status === 'ACCEPTED'`;
  - не изменяет `Proposal.status` (rollback удаляет последнюю `HistoryEntry`).

## Authorization (Phantom signature) для Stage 7 endpoints

В текущей реализации backend Stage 7 (v1) **signature не валидируется** на сервере в endpoints `actions/apply/rollback`.
Фронтенд продолжает подписывать сообщения Phantom в определённых форматах — это контракт message-format для будущей on-chain/off-chain валидации.

### Сообщения для подписи (exact format)

- `add-action`:
  - `message = diploma-z96a action:add:<proposalId>`
- `apply`:
  - `message = diploma-z96a propose:apply:<proposalId>:<contentHash>`
- `rollback`:
  - `message = diploma-z96a propose:rollback:<proposalId>:<historyId>`

Где:
- `proposalId` — `Proposal.id` из URL,
- `contentHash` — `Proposal.contentHash` (Stage 6 fact) из БД (используется в message для apply),
- `historyId` — `HistoryEntry.id` (используется в message для rollback).

## API endpoints Stage 7 (payload/response контракт)

### 1) `POST /api/proposals/:id/actions`

Назначение:
- добавить в `Proposal` новый `ChangeAction` (минимум).

Request body:
```json
{
  "signature": "<base58 ed25519 signature>",
  "actionType": "CREATE|UPDATE|DELETE",
  "targetElementId": "<string|null>",
  "elementPayload": { "...": "..." }
}
```

Правила:
- подписать `diploma-z96a action:add:<proposalId>`
- `targetElementId`:
  - обязателен для `UPDATE` и `DELETE`,
  - опционален для `CREATE`
- `elementPayload` — канонический payload в терминах модели сети (как для Stage 5).

Response:
```json
{
  "ok": true,
  "action": {
    "id": "<ChangeAction.id>",
    "actionType": "CREATE|UPDATE|DELETE",
    "targetElementId": "<string|null>",
    "createdAt": "<ISO-8601 string>"
  }
}
```

Ошибки:
- `400` invalid json
- `400` invalid actionType
- `400` elementPayload must be an object
- `404` proposal not found
- `409` proposal is REJECTED
- `500` failed to create action

### 2) `POST /api/proposals/:id/apply`

Назначение:
- применить `ChangeAction[]` данного `Proposal` к активной модели сети
- записать `HistoryEntry` с `diff` для rollback
- (dev) может перевести `Proposal.status` с `SUBMITTED` на `ACCEPTED`

Request body:
```json
{
  "signature": "<base58 ed25519 signature>"
}
```

Правила:
- backend находит `Proposal` по `:id`
- валидирует статус:
  - в production допускает только `Proposal.status === 'ACCEPTED'`
  - в dev допускает `Proposal.status === 'SUBMITTED'`, после чего переводит в `ACCEPTED`
- применяет `ChangeAction[]` в порядке `ChangeAction.createdAt ASC`:
  - backend создаёт отдельный `HistoryEntry` на каждую action
  - `CREATE`: `diff = { "kind": "CREATE", "createdElementId": "<id>" }`
  - `UPDATE`: `diff = { "kind": "UPDATE", "targetElementId": "<id>", "beforeElement": <snapshot> }`
  - `DELETE`: `diff = { "kind": "DELETE", "targetElementId": "<id>", "deletedElement": <snapshot> }`

Response:
```json
{
  "ok": true
}
```

Ошибки:
- `400` no actions to apply
- `400` invalid elementPayload for CREATE
- `400` targetElementId required for UPDATE/DELETE
- `400` target element not found
- `400` empty elementPayload for UPDATE
- `404` proposal not found
- `409` proposal must be ACCEPTED (если production или неверный статус)
- `500` apply failed

### 3) `POST /api/proposals/:id/rollback`

Назначение:
- откатить последнее apply для данного `Proposal`

Request body:
```json
{
  "signature": "<base58 ed25519 signature>"
}
```

Правила:
- backend находит **последнюю** `HistoryEntry` для `proposalId` (например, по `appliedAt DESC`, затем `id DESC` как tie-breaker)
- в production валидирует, что `Proposal.status === 'ACCEPTED'` (в dev статус не проверяется)
- откатывает изменения по `diff`:
- если `diff.kind == 'CREATE'` — удалить `createdElementId`
- если `diff.kind == 'UPDATE'` — восстановить `targetElementId` полями `beforeElement`
- если `diff.kind == 'DELETE'` — создать `deletedElement`
- удаляет откатываемую `HistoryEntry`
- обновление `Proposal.status` при rollback на v1 в коде **не выполняется**

Response:
```json
{
  "ok": true
}
```

Ошибки:
- `400` no history to rollback
- `404` proposal not found
- `409` proposal must be ACCEPTED (в production)
- `500` invalid history diff / rollback failed

### 4) `GET /api/proposals/:id/history`

Назначение:
- получить список history entries для UI/админки.

Response:
```json
[
  {
    "id": "<HistoryEntry.id>",
    "appliedAt": "<ISO-8601 string>",
    "actionId": "<ChangeAction.id>",
    "appliedByPubkey": "<string|null>"
  }
]
```

Примечание:
- На v1 можно не отдавать `diff` наружу (diff нужен только backend для rollback).

## Ключевая консистентность: contentHash и chain submission

На Stage 7 v1 предлагается:
- фронтенд подписывает messages, но backend v1 endpoints `actions/apply/rollback` пока не валидируют эти подписи;
- apply/rollback сейчас опираются на `ChangeAction[]` и `HistoryEntry.diff.kind` для rollback.

## Вручную проверить контракт Stage 7 (локально)

1) Запустить сервер: `npm run dev`  
2) Открыть страницу `/propose`  
3) Выполнить сценарий в UI:
   - создать Proposal в `DRAFT`
   - добавить хотя бы один `ChangeAction`
   - переключить Proposal в `ACCEPTED` (в коде apply в dev может также принимать `SUBMITTED`)
   - нажать `Apply`
   - убедиться, что появилась запись в `History`
   - нажать `Rollback`
4) Убедиться, что:
   - backend откатывает только последнюю `HistoryEntry`,
   - rollback не падает на `diff.kind` и ожидаемые поля существуют в JSON.

## Stage 8 (polish) — Architect suggestions

- Unify hashing:
  - вынести реализацию `stableStringify` (и сборку canonical input для `contentHash`) в общий shared util;
  - backend-first reuse: backend submit endpoint и scripts/tests должны импортировать тот же stable-алгоритм, чтобы устранить дрейф;
  - frontend использовать тот же stable-алгоритм (а sha256 реализовать раздельно: `crypto.subtle` на клиенте и `node:crypto` на сервере).
- Backend-first validation/limits:
  - ограничить размер `elementPayload`/request bodies в `/api/proposals/:id/actions|apply|rollback`, валидировать ожидаемый shape для CREATE/UPDATE/DELETE;
  - валидировать, что snapshot-поля `beforeElement/deletedElement` имеют обязательный `id` и поля `NetworkElementSnapshot` при применении rollback;
  - сделать “rate limiting / retry safety” на уровне backend, чтобы повторные submissions не создавали лишние HistoryEntry.
