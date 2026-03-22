# Stage 6 (chain + Anchor) — Agent Prompts (copy/paste)

Используй этот файл как единый источник промптов для агентов Stage 6.
В каждом промпте присутствует обязательный “файловый маркер результата”:
агент должен дописать блок в `C:\diploma\DEVELOPMENT_JOURNAL.md` по шаблону.

## Общий шаблон “файлового маркера результата” для каждого агента

В конце работы (после правок) добавь в `DEVELOPMENT_JOURNAL.md` блок:

```md
## Stage 6 (chain + Anchor) — AgentName
Agent: AgentName
Stage: 6 (или precondition)
FilesChanged:
- <list of changed files>
HowToTest:
- <what to verify>
Notes/Risks:
- <risks and what to double-check>
```

## A) RefactorGuardianAgent — precondition stabilize Stage 5

Ты `RefactorGuardianAgent`.

Цель: стабилизировать Stage 5 минимально, чтобы Stage 6 не унаследовал “дубли/разночтения”.

Проверь и приведи к консистентности:
- `src/app/propose/page.tsx`
- `src/app/api/proposals/route.ts`
- `src/app/api/proposals/[id]/route.ts`

Обязательно:
- В каждом из 3 файлов не должно быть дубликатов `export default` или дубликатов обработчиков `GET/POST` в одном модуле.
- Контракт `GET /api/proposals?authorPubkey=<pubkey>&limit=<n>` должен возвращать строго тот формат JSON, который:
  - парсится UI `/propose`
  - проходит smoke-test `scripts/test-proposals.mjs` (если он используется)
- `GET /api/proposals/:id` возвращает proposal вместе с `actions` (пусть empty array).

Не трогай инварианты:
- существующие контракты `/api/network`, `/api/auth/*`, `/api/tile`, `/api/geocode/*`

Definition of Done:
- Сборка/типизация проходят для затронутых файлов.
- Консистентный формат Stage 5 сохранён.

В конце добавь блок в `DEVELOPMENT_JOURNAL.md` по шаблону.

## B) ArchitectAgent — Stage 6 contract (contentHash, message, payload)

Ты `ArchitectAgent`.

Цель: зафиксировать контракт Stage 6 поверх Stage 5.

Входные документы:
- `docs/stage5plus.md`
- `docs/requirements.md`
- `docs/architecture.md`

Требования:
1) Зафиксируй canonical `contentHash`:
   - canonical input (для Stage 5 minimum: `actions=[]`, `title/description` входят как `string|null`)
   - stable stringify правила
   - sha256 output: hex lowercase
2) Зафиксируй message для подписи:
   - `diploma-z96a propose:<contentHash>`
3) Зафиксируй payload/response для endpoint’а Stage 6:
   - `POST /api/proposals/:id/submit`
   - вход: поля строго по контракту (обычно `contentHash` и `signature(base58)`, и всё что нужно по spec)
   - ответ: `{ txSignature: string }` (минимум)
4) Обнови документы:
   - `docs/stage6.md` (или секции внутри `docs/stage5plus.md`)
   - `docs/architecture.md`

Invariants:
- не ломай существующие API контракты Stage 5

Definition of Done:
- Документация однозначно определяет contentHash и message и payload/response.

В конце добавь блок в `DEVELOPMENT_JOURNAL.md` по шаблону.

## C) DBPrismaAgent — schema updates for Stage 6 submission facts

Ты `DBPrismaAgent`.

Цель: добавить минимальные поля для фиксации submission фактов и on-chain факта.

Требования:
- В `prisma/schema.prisma` проверь/добавь в `Proposal`:
  - `contentHash?: string`
  - `signature?: string` (base58)
  - `onChainTxSignature?: string`
  - `onChainSubmittedAt?: Date`
- Добавь/проверь индексы под:
  - фильтрации списка proposals по `authorPubkey` и `status`
  - доступ по `proposalId`
- nullability должна быть совместима с Stage 5 (до submit values могут быть null)

Не ломай:
- существующие модели/связи `User`, `NetworkProvider`, `NetworkElement`

Definition of Done:
- Prisma schema валиден.
- Миграции проходят.
- Stage 5 CRUD proposals не регрессирует.

В конце добавь блок в `DEVELOPMENT_JOURNAL.md` по шаблону.

## D) Web3SolanaAgent — Anchor program + tx interface spec

Ты `Web3SolanaAgent`.

Цель: подготовить on-chain интерфейс для фиксации submission facts.

Требования:
1) Anchor program spec:
   - account model (минимум)
   - instruction минимум: submit proposal / record contentHash
   - какие поля пишутся: `contentHash`, `authorPubkey`/signer, timestamp (минимум)
2) Проверка:
   - допустимая стратегия: off-chain verify backend, on-chain хранит hash (или другой вариант — но явно описать)
3) Tx interface spec для backend:
   - список accounts
   - args
   - program id/idl expectations
4) Документация devnet/local:
   - команды сборки/деплоя
   - конфиг env

Definition of Done:
- BackendAPIAgent может собрать транзакцию без догадок.

В конце добавь блок в `DEVELOPMENT_JOURNAL.md` по шаблону.

## E) BackendAPIAgent — `POST /api/proposals/:id/submit`

Ты `BackendAPIAgent`.

Требование:
Реализуй endpoint:
- `POST /api/proposals/:id/submit`

Поведение:
1) validate input payload по контракту ArchitectAgent:
   - contentHash
   - signature(base58)
2) backend находит Proposal по `id`
3) backend:
   - вычисляет/валидирует contentHash (canonical)
   - проверяет подпись через `tweetnacl + bs58` для message `diploma-z96a propose:<contentHash>`
4) отправляет tx в Solana RPC согласно интерфейсу Anchor program:
   - получает `{ txSignature }`
5) обновляет Proposal в БД:
   - status -> SUBMITTED
   - сохраняет contentHash/signature/onChainTxSignature/onChainSubmittedAt
6) возвращает JSON: `{ txSignature }`

Ошибки:
- 400 bad payload/signature/contentHash
- 404 proposal not found
- 502/500 RPC errors без stacktrace наружу

Invariants:
- не меняй Stage 5 endpoint’ы `/api/network`, `/api/auth/*`, `/api/tile`, `/api/geocode/*`
- не меняй формат `GET /api/proposals`

Definition of Done:
- endpoint стабилен и соответствует контракту Stage 6.

В конце добавь блок в `DEVELOPMENT_JOURNAL.md` по шаблону.

## F) FrontendAgent — UI submit to chain на `/propose`

Ты `FrontendAgent`.

Требование:
Расширь UI `/propose`:
- добавь кнопку “Submit to chain” (на одну/несколько proposals по выбранной логике)
- вычисли canonical `contentHash`
- подпиши message через Phantom:
  - `diploma-z96a propose:<contentHash>`
- вызови `POST /api/proposals/:id/submit`
- покажи `txSignature` и обнови status

Invariants:
- не меняй формат `GET /api/proposals` (UI ждёт массив)
- не трогай визуализацию 3D/2D

Definition of Done:
- UI компилируется, submit вызывает backend корректно и отображает результат.

В конце добавь блок в `DEVELOPMENT_JOURNAL.md` по шаблону.

## G) TestingCIAgent + DocsEditorAgent — validate & finalize docs for Stage 6

TestingCIAgent:
- smoke-тесты:
  - неверная signature -> 400
  - несуществующий proposal id -> 404
  - валидный payload -> 200 + `{ txSignature }`
- тест детерминизма `contentHash` (одинаковый canonical input -> одинаковый hash)
- добавь проверку, что endpoint возвращает ожидаемый JSON shape

DocsEditorAgent:
- обнови `docs/stage6.md`, `docs/stage5plus.md` и `docs/architecture.md` по факту реализации Stage 6
- добавь инструкции как поднять devnet/local и выполнить submit

В конце добавь блок в `DEVELOPMENT_JOURNAL.md` по шаблону.

