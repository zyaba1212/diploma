# Stage 9 Prompts (deployment + observability + operations)

Используйте этот файл как единый источник задач для Stage 9.  
Каждый агент выполняет только свою секцию (A-G) по маппингу из `AGENTS.md`.

---

## A) RefactorGuardianAgent — preflight consistency gate

Цель: убедиться, что перед ops-hardening не сломаны контракты Stage 5-8.

Сделать:
- Проверить, что `GET /api/proposals` возвращает массив.
- Проверить, что `GET /api/proposals/:id` возвращает `actions`.
- Проверить, что `POST /api/proposals/:id/submit` возвращает `txSignature`.
- Проверить, что `GET /api/proposals/:id/history` возвращает массив.
- Сверить `README.md`, `PROJECT_STAGES.md`, `AGENTS.md` между собой.

Критерий готовности:
- Никаких регрессий в контрактах Stage 5-8.
- Зафиксирован список инвариантов перед deployment.

---

## B) ArchitectAgent — deployment architecture

Цель: зафиксировать target deployment topology и операционные инварианты.

Сделать:
- Описать production target (single instance / multi instance, DB, secrets, backup).
- Зафиксировать SLO-lite: доступность API, time-to-recover, max acceptable data loss.
- Добавить runbook: startup/shutdown, health checks, incident flow.
- Определить обязательные env vars для prod/stage.

Критерий готовности:
- Есть понятный документ, по которому можно развернуть и сопровождать систему.

---

## C) DBPrismaAgent — database operations hardening

Цель: подготовить безопасную эксплуатацию PostgreSQL.

Сделать:
- Проверить индексы для “горячих” запросов proposals/history/network.
- Подготовить SQL/runbook для backup и restore (logical dump baseline).
- Добавить инструкции по migration policy (когда `migrate dev`, когда deploy migration).
- Проверить, что rollback истории не ломает referential integrity.

Критерий готовности:
- DB runbook покрывает backup/restore + migration lifecycle.

---

## D) BackendAPIAgent — operational endpoints and guards

Цель: добавить эксплуатационные safeguards без ломки API контрактов.

Сделать:
- Добавить/проверить health endpoint (`/api/health`) с проверкой app + DB reachability.
- Унифицировать формат ошибок для 5xx (без утечек stack traces).
- Проверить rate-limit ключевые endpoints и описать лимиты в docs.
- Добавить минимальные server-side metrics hooks (latency/error counters, если без внешней системы — через structured logs).

Критерий готовности:
- Есть стабильный health-check и predictable поведение ошибок.

---

## E) FrontendAgent — production UX/readiness

Цель: сделать UI устойчивым в production сценариях.

Сделать:
- Убедиться, что ошибки сети/429/5xx отображаются человекочитаемо.
- Проверить UX состояний загрузки для `/propose` и 3D/2D переходов.
- Убедиться, что отключенный кошелек/подпись не ломают страницу.
- Проверить, что клиентский код не использует browser-only API на SSR пути.

Критерий готовности:
- Нет “тихих” ошибок, деградация UX контролируемая.

---

## F) TestingCIAgent — CI/CD baseline

Цель: закрепить автоматические quality gates.

Сделать:
- Настроить workflow c минимумом: `npm ci`, `npm run lint`, `npm run build`.
- Добавить manual/optional smoke workflow для proposals тестов.
- Зафиксировать matrix/Node version policy.
- Добавить fail-fast и понятные логи шагов.

Критерий готовности:
- CI reliably валидирует baseline на каждом PR/push.

---

## G) DocsEditorAgent — final documentation sync

Цель: синхронизировать документацию с фактическим состоянием Stage 9.

Сделать:
- Обновить `README.md` (status + как запускать CI/smoke).
- Обновить `PROJECT_STAGES.md` (отметки done/next).
- Добавить “Operations” раздел в docs (runbooks, env matrix, incident checklist).
- Проверить, что все инструкции исполнимы copy-paste.

Критерий готовности:
- Документация отражает текущий код и операционные процедуры.
