# Stage 5–7: Propose / Chain / History (дизайн)

Этот документ описывает **структуру данных и целевой дизайн** для режимов Propose / Chain / History.  
Часть функционала Stage 5 реализована (сущности Proposal/ChangeAction в БД, базовые эндпоинты `/api/proposals`, базовый UI `/propose`), остальное остаётся планом на следующие стадии.

## Базовые сущности (предлагаемая модель данных)

### Proposal

Единица предложения изменений сети.

- `id: string` — уникальный идентификатор предложения (UUID/ULID).
- `scope: "GLOBAL" | "LOCAL"` — область действия изменений (вся сеть или локальный bbox/провайдер).
- `authorPubkey: string` — публичный ключ автора; логически ссылается на `User.pubkey`.
- `status: "DRAFT" | "SUBMITTED" | "ACCEPTED" | "REJECTED" | "APPLIED" | "CANCELLED"`  
  - Stage 5 минимум: используются `DRAFT`, `SUBMITTED`, `ACCEPTED`, `REJECTED`.  
  - `APPLIED`, `CANCELLED` — задел для последующих стадий (применение/отмена).
- `title?: string` — краткий заголовок предложения (опционально).
- `description?: string` — расширенное описание / justification (опционально).
- `contentHash?: string` — хэш канонического содержимого предложения (см. ниже). Заполняется при `SUBMITTED` (Stage 6).
- `signature?: string` — base58‑подпись автора по `contentHash` (используется начиная с Stage 6).
- `onChainTxSignature?: string` — подпись транзакции в сети (минимальный on-chain факт submission).
- `onChainSubmittedAt?: Date` — момент, когда submission зафиксирован в блокчейне (минимальная on-chain метка времени).
- `createdAt: Date` — время создания.
- `updatedAt: Date` — время последнего изменения.
- `submittedAt?: Date` — момент перевода в `SUBMITTED`.
- `decidedAt?: Date` — момент перевода в конечный статус `ACCEPTED|REJECTED|CANCELLED|APPLIED`.

### ChangeAction

Отдельное действие в рамках Proposal. Proposal содержит **список** `ChangeAction`.

- `id: string` — уникальный идентификатор действия.
- `proposalId: string` — внешний ключ на `Proposal.id`.
- `actionType: "CREATE" | "UPDATE" | "DELETE"` — тип изменения.
- `targetElementId?: string` — идентификатор изменяемого/удаляемого элемента сети (для `UPDATE`/`DELETE`).
- `elementPayload: Json` — канонический payload элемента или патча (структура синхронизируется с моделью сети).
- `reversePayload?: Json` — данные для обратного применения действия (используются на Stage 7).
- `createdAt: Date` — время добавления действия в предложение.

### HistoryEntry

Аудит‑запись для отката. Создаётся в момент `apply` (v1: по одному `HistoryEntry` на каждую `ChangeAction`).

- `id: string` — уникальный идентификатор истории.
- `proposalId: string` — ссылка на исходное предложение.
- `actionId: string` — ссылка на конкретное действие `ChangeAction`.
- `appliedByPubkey?: string` — публичный ключ модератора/сервиса, применившего действие (если есть).
- `appliedAt: Date` — момент фактического применения.
- `diff: Json` — discriminated union `ChangeActionDiff` (используется для rollback):
  - `{ kind: "CREATE", createdElementId: string }`
  - `{ kind: "UPDATE", targetElementId: string, beforeElement: NetworkElementSnapshot }`
  - `{ kind: "DELETE", targetElementId: string, deletedElement: NetworkElementSnapshot }`

`NetworkElementSnapshot` — snapshot “до” для `NetworkElement` (все поля Prisma, которые требуются для восстановления состояния элемента):
- `id`, `scope`, `type`, `providerId`, `sourceId`
- `name`, `lat`, `lng`, `altitude`
- `path`, `metadata`

## Канонизация и hash (Stage 6)

Чтобы подписи были воспроизводимыми, обе стороны (Frontend и Backend) должны использовать один и тот же **stable stringify** и один и тот же **канонический вход** для `contentHash`.

### Canonical вход для Stage 6 v1 (минимальный Stage 5)

Для Stage 5 minimum (нет редактора `ChangeAction`) считается, что:

- `actions = []`
- `proposalFields` содержит:
  - `scope: "GLOBAL" | "LOCAL"` (всегда),
  - `title` — **включается только если** `Proposal.title != null`,
  - `description` — **включается только если** `Proposal.description != null`.

Канонический объект для хэширования (для Stage 5 minimum):

```json
{
  "proposalFields": {
    "scope": "GLOBAL" | "LOCAL"
  },
  "actions": []
}
```

### Stable stringify (stableJson)

`stableJson(x)` — детерминированная сериализация:

1. Для объектов: рекурсивно сортировать ключи **лексикографически** по строковому представлению ключей (в пределах одного уровня объекта).
2. Для массивов: сохранять исходный порядок элементов (индексы важны).
3. Сериализация примитивов — стандартный JSON (RFC8259):
   - строки — в виде JSON string (двойные кавычки + JSON escaping),
   - `null` — буквально `null`,
   - числа/булевы — как в обычном JSON,
   - `undefined` в каноническом объекте не используется: ключи со значением `undefined` пропускаются (ключ отсутствует).
4. У сериализованной строки не должно быть произвольных пробелов/переносов строк (строка как результат детерминированного string builder).

### contentHash

`contentHash = sha256( UTF8(stableJson(canonicalInput)) )`, где SHA-256 возвращает digest в **hex lowercase** (32 байта => 64 hex-символа).

### Подпись для Stage 6

Пользователь подписывает message:

- `diploma-z96a propose:<contentHash>`

и передаёт подпись как base58-строку.

### Что именно хранится при Stage 6 submission

Минимальный набор фактов, чтобы submission можно было воспроизвести/проверить позже:

- `Proposal.contentHash`
- `Proposal.signature` (base58) — подпись автора по `contentHash`
- опционально: `Proposal.onChainTxSignature` и `Proposal.onChainSubmittedAt` (если делаем on-chain фиксацию)

При этом статус предложения на текущем этапе остаётся в рамках `SUBMITTED` (UI `/propose` и текущий API не требуют дополнительных enum-значений).

Фактически Stage 6 добавляет в БД только submission facts (`contentHash`/`signature` и on-chain поля), не меняя UI-логику `/propose`; дальнейшие переходы вроде `APPLIED` и `CANCELLED` зарезервированы в enum и будут задействованы на следующих стадиях.

## API (предлагаемые эндпоинты Stage 5)

Реализованный минимум Stage 5:
- `POST /api/proposals` создать `Proposal` в статусе `DRAFT`;
- `GET /api/proposals` список;
- `GET /api/proposals/:id` детали.

Планируется как продолжение Stage 5 (Propose editor / submit / apply):
- `POST /api/proposals/:id/actions` добавить `ChangeAction` к предложению;
- `POST /api/proposals/:id/submit` перевести в `SUBMITTED` (для подписи на Stage 6);
- `POST /api/proposals/:id/decide` установить `ACCEPTED` или `REJECTED` (роль модератора, позже);
- `POST /api/proposals/:id/apply` применить принятое предложение к активной сети + записать историю.

