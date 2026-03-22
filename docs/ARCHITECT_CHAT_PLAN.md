# План из чата ArchitectAgent (канон для мультиагентной работы)

**Источник:** экспорт Cursor `cursor_1_architect.md` (пользователь), зафиксировано в репозитории **2026-03-20**.

**Назначение:** единая схема этапов, зон агентов и **скрипт запуска Stage 5**. Координатор и ArchitectAgent **придерживаются** этого документа; актуальность кода — ещё `PROJECT_STAGES.md`.

> В оригинальном чате также упоминался файл плана Cursor:  
> `c:\Users\zyaba\.cursor\plans\diploma-z96a-multi-agent-plan_3359d43f.plan.md` — если он есть локально, считать приложением к этому же плану.

---

## 1. Высокоуровневые этапы

| Блок | Содержание |
|------|------------|
| **Stage 0–1** | Каркас Next.js + Prisma + Phantom auth |
| **Stage 2–4** | 3D/2D визуализация сети, `GET /api/network`, скрипты импорта |
| **Stage 5–7** | Режим Propose, подписи/chain, история/откат |
| **Stage 8** | Полировка (perf, security, UX) |

*По факту репозитория Stages 0–12 закрыты baseline (см. `PROJECT_STAGES.md`); этот раздел — **логика из чата**, не отменяет фактического статуса.*

---

## 2. Зоны ответственности агентов (план из чата)

### ArchitectAgent
- Архитектура и инварианты: `docs/architecture.md`, `docs/requirements.md`, `docs/etapy.md`, `PROJECT_STAGES.md`.
- Реестр: `AGENTS.md`, промпты в `docs/agents/*.md`.
- Дизайн Stage 5–7: `docs/stage5plus.md`, ссылки в архитектуре.

### DBPrismaAgent
- **0–4:** `User`, `NetworkProvider`, `NetworkElement`, индексы под `/api/network`, seed.
- **5–7:** `Proposal`, `ChangeAction`, `HistoryEntry` по `docs/stage5plus.md`, миграции без поломки существующего.

### BackendAPIAgent
- **0–4:** `/api/network`, `/api/auth/*`, `/api/tile`, `/api/geocode/*`.
- **5–7:** `/api/proposals/*` по `docs/stage5plus.md` (CRUD, submit, decide, apply и т.д. по стадиям).

### FrontendAgent
- **0–4:** главная, layout, `EarthScene`, `MapView`, `AuthBlock`, маршруты.
- **5:** UI Propose — формы, списки, статусы через `/api/proposals/*`.

### ThreeLeafletAgent
- **2–4:** `EarthScene`, `MapView`, 3D↔2D, грабли Leaflet (см. `DEVELOPMENT_JOURNAL.md`).
- Далее: выделение, hover, фильтры.

### Web3SolanaAgent
- **1:** `AuthBlock` → `signMessage` → `POST /api/auth/verify`, совместимость сообщения.
- **6+:** `contentHash`, подпись propose, Anchor/tx — отдельный модуль.
- **Доп. (проект):** политика autoconnect / кошелёк — `docs/agents/wallet-autoconnect-prompt.md`.

### ScriptsImportAgent
- `scripts/sync-submarine-cables.mjs`, спутники и т.д.; `sourceId`, идемпотентность; `docs/network-data-and-sources.md`.

### TestingCIAgent / DocsEditorAgent / RefactorGuardianAgent
- Smoke, актуализация `docs/*`, контроль контрактов API и auth-flow.

---

## 3. Stage 5 (Propose‑mode) — цель из чата

- Пользователь через Phantom создаёт **Proposal**; внутри — **ChangeAction** (CREATE/UPDATE/DELETE элементов сети).
- Статусы: `DRAFT → SUBMITTED → ACCEPTED/REJECTED`, хранение в БД.
- **Без блокчейна** на Stage 5 (только off-chain).

*Реализация минимума Stage 5 в коде — отражена в `PROJECT_STAGES.md`.*

---

## 4. Скрипт запуска агентов (Stage 5) — порядок шагов

Выполнять **по очереди**; каждому агенту выдавать роль + этот шаг.

| Шаг | Агент | Суть |
|-----|--------|------|
| **1** | **ArchitectAgent** | Финализировать дизайн в `docs/stage5plus.md`, раздел Propose в `docs/architecture.md`, Stage 5 в `PROJECT_STAGES.md` (эндпоинты, статусы, без блокчейна). Не ломать контракты `/api/network`, `/api/auth/*`, `/api/tile`, `/api/geocode/*`. |
| **2** | **DBPrismaAgent** | Модели `Proposal`, `ChangeAction` в `prisma/schema.prisma` по доке; enum’ы; связи; не трогать `User`/`NetworkProvider`/`NetworkElement` ломающе. |
| **3** | **BackendAPIAgent** | `POST /api/proposals`, `GET /api/proposals`, `GET /api/proposals/:id` (минимальный CRUD). |
| **4** | **Web3SolanaAgent** | Надёжный `authorPubkey` на фронте для запросов; при необходимости хук/контекст; кратко в `docs/requirements.md` про связь Phantom и proposals. Не менять `/api/auth/verify`. |
| **5** | **FrontendAgent** | UI `/propose`: список «мои предложения», форма создания, вызовы API. |
| **6** | **TestingCIAgent** + **DocsEditorAgent** | Тесты/смоук для `/api/proposals`; обновить `docs/*`, `README`, статус Stage 5 без выдуманных фич. |

**Второй волной** (после первой итерации фронта), как в чате: `POST /api/proposals/:id/actions`, `POST /api/proposals/:id/submit` и далее по `docs/stage5plus.md` / `PROJECT_STAGES.md`.

---

## 5. Статус синхронизации с репозиторием (ведёт координатор)

| Элемент плана | Статус на 2026-03-20 |
|---------------|----------------------|
| Этапы 0–12 baseline | См. `PROJECT_STAGES.md` — задокументировано как done |
| Скрипт Stage 5 (шаги 1–6) | Исторически закрыт минимумом; детали — код + `docs/stage5plus.md` |
| Auth / Profile (username, кабинет) | **Не** из этого чата; ведётся по `docs/agents/auth-profile-phase-prompts.md` |
| Autoconnect / idle кошелька | **Не** из этого чата; ведётся по `docs/agents/wallet-autoconnect-prompt.md` |

**Текущая очередь работ** — в **`docs/COORDINATOR_DEV_PLAN.md`** (приоритеты и правки по ходу).

---

## 6. Правила ведения документа

- Любое **существенное** изменение порядка этапов или зон агентов — правка **этого файла** + строка в `DEVELOPMENT_JOURNAL.md`.
- Если шаг скрипта **не нужен** в новой задаче — координатор **явно** пишет владельцу и в `COORDINATOR_DEV_PLAN.md`, кому не слать промпт.
