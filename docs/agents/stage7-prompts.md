# Stage 7 (history + rollback) — Agent Prompts (copy/paste)

Этот файл — единый источник промптов для агентов, выполняющих следующий шаг после Stage 6.

## Важно про порядок
Stage 7 зависит от наличия действий изменения сети (ChangeAction) и механизма применения/отката. Поэтому в Stage 7 мы делаем:
- минимальное управление `ChangeAction` в рамках Proposal (endpoint + UI частично),
- endpoint’ы применения и отката,
- модель `HistoryEntry` для аудита/rollback.

## A–G соответствие агентам
- `RefactorGuardianAgent` → **A**
- `ArchitectAgent` → **B**
- `DBPrismaAgent` → **C**
- `Web3SolanaAgent` → **D**
- `BackendAPIAgent` → **E**
- `FrontendAgent` → **F**
- `TestingCIAgent` и/или `DocsEditorAgent` → **G**

## Правило “файлового маркера результата”
После выполнения добавь в `DEVELOPMENT_JOURNAL.md` блок:
```md
## Stage 7 (history + rollback) — AgentName
Agent: AgentName
Stage: 7
FilesChanged:
- <...>
HowToTest:
- <...>
Notes/Risks:
- <...>
```

## Контекст (что уже есть)
- Stage 5 CRUD proposals: `POST /api/proposals`, `GET /api/proposals`, `GET /api/proposals/:id`
- Stage 6 submission endpoint: `POST /api/proposals/:id/submit` (в dev работает как stub txSignature)
- UI `/propose` уже умеет “Submit to chain”

## Чего пока нет (минимум для Stage 7)
- endpoint для добавления `ChangeAction` к proposal’у (`/api/proposals/:id/actions`)
- механизм `apply` и `rollback` (и хранение history)
- модель `HistoryEntry` в Prisma

---

## A) RefactorGuardianAgent — Stage 7 precondition check

Ты `RefactorGuardianAgent`.

Цель: перед Stage 7 убедиться, что Stage 5 и Stage 6 контракты не поломаны.

Проверь:
- `src/app/propose/page.tsx` не содержит дубликатов компонентов/handlers и соответствует текущим типам ответа `GET /api/proposals`.
- `src/app/api/proposals/route.ts` возвращает JSON **массив** `ProposalDTO[]`.
- `src/app/api/proposals/[id]/route.ts` возвращает proposal и поле `actions` (пусть empty array).
- `src/app/api/proposals/[id]/submit/route.ts` обновляет Proposal в статус `SUBMITTED` и возвращает `{ txSignature }`.

Не меняй функциональность без необходимости.

Definition of Done:
- Precondition выполнен, можно безопасно переходить к apply/history/rollback.

В конце: добавь маркер результата в `DEVELOPMENT_JOURNAL.md`.

---

## B) ArchitectAgent — Stage 7 data model + apply/rollback contract

Ты `ArchitectAgent`.

Цель: определить контракт Stage 7 и минимальную стратегию rollback.

Требования:
1) Источник правды для rollback:
   - Предложи простой и надёжный v1 способ, например “snapshot-before-apply” для затронутых `NetworkElement` (store old JSON in `HistoryEntry.diff`), чтобы rollback мог восстановить состояние.
2) DB/схема Proposal:
   - нужен ли статус `APPLIED` и `CANCELLED`? (согласуй, чтобы enums Prisma и UI не ломались)
3) API endpoints Stage 7:
   - `POST /api/proposals/:id/actions` (минимально) — добавить `ChangeAction` в proposal
   - `POST /api/proposals/:id/apply` — применить proposal к активной сети и записать history
   - `POST /api/proposals/:id/rollback` — откатить последнее применённое действие/применение (минимально)
   - `GET /api/proposals/:id/history` — список history entries (минимально)
4) Payload/response схемы для apply/rollback:
   - что нужно во входе (proposalId может быть в пути, авторизация через Phantom — входные поля)
   - какой response ожидается фронтом (например `{ ok: true }` и/или `{ historyId, appliedAt }`)

Не меняй без согласования уже существующие контракты Stage 5/6.

В конце: добавь маркер результата в `DEVELOPMENT_JOURNAL.md` и обнови доки:
- `docs/architecture.md`
- при необходимости `docs/stage7.md` и `docs/stage5plus.md`

---

## C) DBPrismaAgent — HistoryEntry + enum расширение

Ты `DBPrismaAgent`.

Цель: расширить Prisma под Stage 7.

Требования:
1) `prisma/schema.prisma`:
   - добавить модель `HistoryEntry`
   - расширить `ProposalStatus` при необходимости под `APPLIED`/`CANCELLED`
2) Хранение diff:
   - `HistoryEntry.diff` (Json) должен быть таким, чтобы rollback мог восстановить NetworkElement.
3) Индексы:
   - быстрый доступ по `proposalId`
   - (опционально) по `createdAt/appliedAt`
4) Не ломать:
   - `GET /api/proposals` и `GET /api/proposals/:id` (они могут начать возвращать новые поля, но должны оставаться совместимыми с UI)

В конце: добавь маркер результата в `DEVELOPMENT_JOURNAL.md`.

---

## D) Web3SolanaAgent — влияние chain submissions на history/apply

Ты `Web3SolanaAgent`.

Цель: согласовать, какие поля Stage 6 (contentHash/txSignature) нужно учитывать в Stage 7.

Требования:
- На уровне спецификации explain:
  - применяем ли proposal только если он SUBMITTED и имеет `onChainTxSignature`?
  - как и когда проверять contentHash/подпись для apply/rollback (если вообще нужно на v1)
- Если требуется: предложи минимальные поля/валидации, не усложняя v1.

В конце: маркер результата в `DEVELOPMENT_JOURNAL.md`.

---

## E) BackendAPIAgent — implement actions/apply/rollback/history endpoints

Ты `BackendAPIAgent`.

Цель: реализовать endpoint’ы Stage 7.

Требования:
1) Добавь endpoint:
   - `POST /api/proposals/:id/actions`
   - принимает `actionType` и `targetElementId?` и `elementPayload` (минимум)
2) Добавь apply endpoint:
   - `POST /api/proposals/:id/apply`
   - логика:
     - валидировать status предложения (как определит ArchitectAgent)
     - применить `ChangeAction[]` к `NetworkElement` в БД
     - записать `HistoryEntry` с `diff` для rollback
     - обновить `Proposal` статус (как определит ArchitectAgent)
3) Добавь rollback endpoint:
   - `POST /api/proposals/:id/rollback`
   - логика:
     - найти последнюю `HistoryEntry` и применить reverse через stored diff
     - обновить status proposal (минимально)
4) Добавь history list endpoint:
   - `GET /api/proposals/:id/history`
5) Ошибки:
   - аккуратные JSON ошибки: 400/404/409/500
   - не leak stacktrace

Инварианты:
- Не ломай существующие маршруты:
  - `/api/network`
  - `/api/auth*`
  - `/api/tile`
  - `/api/geocode*`
  - Stage 5/6 proposals endpoints по контрактам форматов.

Definition of Done:
- endpoints работают согласованно: actions → apply → history → rollback.

В конце: маркер результата в `DEVELOPMENT_JOURNAL.md`.

---

## F) FrontendAgent — minimal UI for actions/apply/history/rollback

Ты `FrontendAgent`.

Цель: сделать минимальный интерфейс для Stage 7 на базе `/propose`.

Требования (v1):
1) UI для добавления ChangeAction:
   - минимальный вариант: форма для `actionType` + JSON payload (текстовое поле) и, если нужно, `targetElementId`
   - отправка в `POST /api/proposals/:id/actions`
2) UI для apply/rollback:
   - кнопка `Apply` (если proposal в нужном статусе)
   - кнопка `Rollback`
3) UI для history:
   - список history entries `GET /api/proposals/:id/history`
4) Не ломай:
   - текущий список/создание proposals
   - текущий flow “Submit to chain”

В конце: маркер результата в `DEVELOPMENT_JOURNAL.md`.

---

## G) TestingCIAgent + DocsEditorAgent — validate and document Stage 7

TestingCIAgent:
- добавь smoke/интеграционные проверки:
  - `POST /api/proposals/:id/actions` валидный/невалидный payload
  - `POST /api/proposals/:id/apply` меняет NetworkElement и создаёт HistoryEntry
  - `POST /api/proposals/:id/rollback` возвращает NetworkElement к prior state
  - `GET /api/proposals/:id/history` возвращает список

DocsEditorAgent:
- обнови `docs/architecture.md`
- добавь `docs/stage7.md` (или расширь существующие доки), где перечислены:
  - endpoints
  - payload/response
  - как устроен rollback diff

В конце: маркер результата в `DEVELOPMENT_JOURNAL.md`.

