# Stage 12 Prompts (implementation of Stage 11 + governance / moderation baseline)

**Общий промпт** для всех агентов на этом этапе выдаёт координатор **в чате** при старте этапа (в этот файл не копируется). Здесь — только секции **A–G**; маппинг ролей → букв: `AGENTS.md` (раздел Stage 12).

**Scope этапа:** `docs/stage12-scope.md` · **архитектура Stage 11:** `docs/stage11-post-launch-architecture.md`

---

## A) RefactorGuardianAgent — preflight Stage 12

- Проверить, что **публичные контракты** Stage 5–8 не ломаются: те же пути `/api/proposals/*`, форматы ответов, коды ошибок.
- Новые возможности только под **`/api/moderation/*`** (или согласованный префикс) без «тихих» изменений старых хендлеров.
- Зафиксировать список файлов/модулей, которые будут затронуты (rate limit, Redis, moderation), чтобы не было пересечений без ревью.

---

## B) ArchitectAgent — финализация целевой архитектуры Stage 12

- Зафиксировать решение: **Redis** (или аналог) для shared rate limit; fallback при отсутствии `REDIS_URL` (один инстанс / dev) — явно описать в `docs/architecture.md` или `docs/operations.md`.
- **Moderation:** схема allowlist модераторов (`MODERATOR_PUBKEYS` / env), поток `SUBMITTED → ACCEPTED|REJECTED`, идемпотентность, защита от двойного решения.
- Связать SLO/алерты из `docs/operations.md` с появлением Redis и пула БД (что мониторить после релиза).

---

## C) DBPrismaAgent — пул БД и данные для аудита модерации

- **Connection pooling:** задокументировать/поддержать целевой вариант (PgBouncer / параметры managed Postgres) — без изменения семантики запросов Prisma.
- При необходимости: минимальная схема/таблица для **audit trail** решений модерации (кто, когда, `proposalId`, старый/новый статус) — миграция с `expand`-подходом, zero-downtime по возможности.
- Индексы под списки proposals (если появятся новые фильтры по статусу для модерации).

---

## D) BackendAPIAgent — Redis rate limit, лимиты body, API модерации

- Реализовать **абстракцию rate limit** с бэкендом in-memory (dev/single) и **Redis** (staging/prod, 2+ инстансов), сохраняя: `429`, заголовки/limit semantics как сейчас.
- **Единые лимиты размера body** на mutation-маршрутах proposals — общая утилита + покрытие тестами/документация.
- **`/api/moderation/*`**: эндпоинты для смены статуса по правилам (только allowlist), подпись Phantom или серверная проверка pubkey — по согласованной с командой схеме; **не ломать** существующие контракты `/api/proposals/*` без необходимости.

---

## E) FrontendAgent — UX модерации (минимум)

- Минимальный **защищённый UI** (например `/moderate` или внутри существующего layout): список `SUBMITTED` + действия accept/reject; только если кошелёк в allowlist (или отдельное сообщение «нет прав»).
- Обработка `429`/ошибок сети при вызовах moderation API; не ломать `/propose` и кошелёк.

---

## F) TestingCIAgent — тесты и приёмка

- Тесты/моки для rate limit (in-memory; при наличии — интеграционный сценарий с Redis в CI опционально).
- Smoke или unit для moderation API (403/401 без прав, успех с моком allowlist).
- Обновить `docs/operations.md` или чеклист: ручной сценарий «2 инстанса + общий Redis → согласованный 429» (если автоматизация тяжела).

---

## G) DocsEditorAgent — документация Stage 12

- Обновить `README.md`, `docs/architecture.md`, `docs/operations.md`, `docs/etapy.md`, `PROJECT_STAGES.md` по факту реализации.
- `.env.example`: новые переменные (`REDIS_URL`, `MODERATOR_PUBKEYS` или аналог) с комментариями.
- Ссылка на `docs/stage12-scope.md` — статус «реализовано / частично» по пунктам.

---

## Цель Stage 12 (кратко)

**Внедрить** то, что в Stage 11 было описано (shared rate limit, pool, лимиты), и добавить **управляемый поток модерации** — без изменения публичных API-контрактов Stage 5–8 для существующих клиентов.
