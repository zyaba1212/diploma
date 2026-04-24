# Stage 8 (polish: perf/security/UX) — Agent Prompts (copy/paste)

Этот файл — единый источник промптов для агентов, выполняющих следующий шаг после Stage 7.

## A–G соответствие агентам
- `RefactorGuardianAgent` → **A**
- `ArchitectAgent` → **B**
- `DBPrismaAgent` → **C**
- `Web3SolanaAgent` → **D**
- `BackendAPIAgent` → **E**
- `FrontendAgent` → **F**
- `TestingCIAgent` и/или `DocsEditorAgent` → **G**

## Обязательный “файловый маркер результата”
После выполнения добавь в конец `DEVELOPMENT_JOURNAL.md` блок:

```md
## Stage 8 (polish) — AgentName
Agent: AgentName
Stage: 8
FilesChanged:
- <...>
HowToTest:
- <...>
Notes/Risks:
- <...>
```

## Что уже есть к Stage 7 (контекст)
- Stage 7 endpoint’ы:  
  - `POST /api/proposals/:id/actions`  
  - `POST /api/proposals/:id/apply`  
  - `POST /api/proposals/:id/rollback`  
  - `GET /api/proposals/:id/history`
- Prisma: модель `HistoryEntry` есть.
- UI: `/propose` показывает actions/apply/rollback/history и “Submit to chain”.

## Главные цели Stage 8
- Perf: убрать лишние refetch/дорогие вычисления, снизить нагрузку на API и сцену.
- Security: усилить валидацию входных данных и защиту от злоупотреблений внешних прокси/endpoint’ов.
- UX: улучшить сообщения об ошибках, loading-состояния, понятность статусов.

---

## A) RefactorGuardianAgent — Stage 8 pre-check & invariants

Проверь:
- что Stage 5/6/7 контракты и ответы не “сломались” после добавления UI/logic Stage 7;
- что:
  - `GET /api/proposals` возвращает JSON-массив, совместимый с `/propose`;
  - `GET /api/proposals/:id` содержит `actions` (пусть пустой массив);
  - `POST /api/proposals/:id/submit` возвращает `{ txSignature }`;
  - Stage 7 endpoints возвращают предсказуемую форму ошибок/ok-сообщений.

Инварианты:
- не менять базовые контракты `/api/network`, `/api/auth/*`, `/api/tile`, `/api/geocode/*`;
- stable hashing и message format для Stage 6 остаются совместимыми.

В конце добавь маркер результата в журнал.

---

## B) ArchitectAgent — unify contracts & fix docs/behavior drift

Цель: уменьшить дрейф “документация vs реальное поведение”.

Требования (минимум):
1) Сверь `docs/stage7.md` со **фактическим** форматом `HistoryEntry.diff`, который ожидает backend rollback.
   - rollback сейчас парсит `latest.diff` и ожидает `diff.kind` (CREATE/UPDATE/DELETE) в реальном коде.
   - убедись, что docs отражают именно эту структуру (или предложи корректировку кода, но только согласованно).
2) Сверь канонизацию `contentHash`:
   - что frontend делает stable stringify,
   - что backend recomputes в submit endpoint’е.
3) Предложи “минимальные улучшения” архитектурно:
   - где вынести hashing/stable stringify в один shared util,
   - где добавить лимиты/валидации (в какую сторону — backend-first).

В конце добавь маркер результата в журнал.

---

## C) DBPrismaAgent — indexes & schema hardening

Цель: ускорить запросы Stage 7/8 и сделать схему устойчивой.

Требования:
1) Проверь индексы в `prisma/schema.prisma`:
   - `HistoryEntry` по `proposalId`/`appliedAt`/`actionId` (достаточно ли для rollback/history list).
2) Если обнаружишь, что raw-SQL таблица `HistoryEntry` (historyStore) может конфликтовать с Prisma-моделью — согласуй единый подход:
   - либо миграции + Prisma client всегда,
   - либо raw SQL всегда.
3) Подготовь (и опиши) план дополнительных индексов/ограничений:
   - например, ограничить размер JSON diff (если возможно в БД),
   - добавить проверку на действительность `actionType`.

В конце добавь маркер результата в журнал.

---

## D) Web3SolanaAgent — security around submit endpoint

Цель: усилить безопасность и эксплуатационную надежность Stage 6 submit.

Требования:
1) Проверь, как в backend хранится payer key:
   - какие env переменные,
   - какие форматы (base58 vs JSON array),
   - чтобы не утекали ключи в логи.
2) Предложи rate-limit/guard:
   - повторная отправка submit при наличии `onChainTxSignature`,
   - защита от больших request bodies.
3) Документируй “Production readiness checklist”:
   - какие env переменные нужны,
   - как проверять RPC endpoint,
   - какой fallback/ошибка при ошибках RPC.

В конце добавь маркер результата в журнал.

---

## E) BackendAPIAgent — rate limiting, payload validation, error UX

Цель: сделать backend устойчивым и безопасным.

Требования (минимум):
1) `/api/proposals/:id/actions`, `/apply`, `/rollback`:
   - усилить валидацию `elementPayload` (тип, минимальный shape),
   - валидация size/structure, понятные 400 errors.
2) `/api/tile` и `/api/geocode/*`:
   - добавить allowlist для `source` у tile,
   - добавить timeouts/ограничения запросов,
   - rate limiting (хотя бы per-IP в рамках Next/Edge, как доступно).
3) Ошибки:
   - стандартизировать shape `{ error: string }`/`{ ok: true, ... }`.
4) Дубли/утечки:
   - убрать (если есть) дубли helper’ов hashing/stable stringify между Stage 6 и Stage 7.

В конце добавь маркер результата в журнал.

---

## F) FrontendAgent — perf and UX improvements for /propose

Цель: улучшить страницу `/propose` и устранить лишние вычисления.

Требования:
1) Упростить состояние:
   - не держать лишние большие объекты в state,
   - минимизировать re-render.
2) Оптимизировать загрузки:
   - debounce/refetch throttling (если есть),
   - показать skeleton/loading и не блокировать UI.
3) UX:
   - лучшее отображение ошибок по action/apply/rollback/submit,
   - понятные подсказки для `elementPayload` (хотя бы шаблон JSON).
4) Perf:
   - stable stringify/sha256:
     - не пересчитывать contentHash без необходимости,
     - кэшировать для выбранной proposalDetails (если можно).

В конце добавь маркер результата в журнал.

---

## G) TestingCIAgent + DocsEditorAgent — tests and final doc alignment

Требования:
1) Testing:
   - добавить/расширить smoke-tests для Stage 8 критичных endpoint’ов:
     - `/api/proposals/:id/actions`
     - `/api/proposals/:id/apply`
     - `/api/proposals/:id/rollback`
     - `/api/proposals/:id/history`
   - добавить негативные тесты: неверный payload size/shape, неверная signature, неверный status.
2) Docs:
   - обновить `docs/stage7.md` так, чтобы `HistoryEntry.diff` соответствовал фактическому формату из backend rollback (diff.kind / CREATE-UPDATE-DELETE).
   - проверить `docs/stage6.md` и `docs/stage5plus.md` на консистентность формулы `contentHash`.

В конце добавь маркер результата в журнал.

