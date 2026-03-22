# AGENTS

Единый реестр агентов проекта и правила работы.

## TL;DR контекст проекта

Проект — WEB3 Next.js приложение для визуализации инфокоммуникационной сети на 3D-глобусе (Three.js) с переходом в 2D-карту (Leaflet). Авторизация через Phantom (Solana) по подписи сообщения, хранение данных в PostgreSQL через Prisma.

### Как «делегировать» роли в Cursor

Роли ниже (**DBPrismaAgent** и др.) — **не отдельные автоматические процессы**. Чтобы разнести работу: открой **новый чат** и явно укажи роль + секцию из `docs/agents/*.md`. Один чат с ассистентом = один поток исполнения; координацию между ролями ведёт человек или чеклист в `DEVELOPMENT_JOURNAL.md`.

Правила для **чата координатора** в Cursor: `.cursor/rules/coordinator-architect.mdc` (делегирование, промпты в файлы, общий промпт в чат, приёмка, оповещение о незадействованных ролях).

Полная схема этапов и **скрипт запуска агентов (Stage 5)** из чата ArchitectAgent: **`docs/ARCHITECT_CHAT_PLAN.md`**. Текущие приоритеты: **`docs/COORDINATOR_DEV_PLAN.md`**.

Локальная БД в Docker и порядок команд Prisma: **`docs/local-dev-docker.md`**.

## Общие правила (для всех агентов)

- Не менять **API контракты** и ключевые маршруты без отдельной задачи (см. `PROJECT_STAGES.md`).
- Для любых изменений сначала сверяться с `docs/requirements.md` и `docs/architecture.md`.
- БД меняет только агент БД (см. ниже); API-агент синхронизируется с изменениями схемы.
- Любые «грабли» фиксировать в `DEVELOPMENT_JOURNAL.md`.
- Для этапов с маппингом **A–G**: **общий промпт** координатор выдаёт **в чате** при старте этапа; в `docs/agents/stage*-prompts.md` и в **`docs/agents/ux-globe-phase-prompts.md`** — секции по агентам; в **UX / Globe phase** общий промпт также **внутри файла** (копипаст в чат). **Букву A–G подставляет не координатор, а сам агент** по своей роли и таблице маппинга в файле/`AGENTS.md` (см. `.cursor/rules/agent-prompts-letters.mdc`).

## Агенты

Файлы промптов лежат в `docs/agents/`. Дополнительно: **autoconnect / idle кошелька** — `docs/agents/wallet-autoconnect-prompt.md` (копипаст-промпт и ссылки на код).

- **ArchitectAgent**: главный проектировщик (архитектура/инварианты/документация).
- **FrontendAgent**: Next.js UI и компоненты (`src/app`, `src/components`).
- **ThreeLeafletAgent**: 3D/2D визуализация, lifecycle карт, производительность.
- **BackendAPIAgent**: route handlers (`src/app/api/*`), кеширование, безопасность.
- **DBPrismaAgent**: `prisma/schema.prisma`, миграции, индексы, сид.
- **Web3SolanaAgent**: Phantom auth (сейчас), позже Anchor/tx flow.
- **ScriptsImportAgent**: `scripts/*` импорт данных в БД.
- **TestingCIAgent**: тесты, линт, CI.
- **DocsEditorAgent**: актуализация `docs/*`, `README.md`.
- **RefactorGuardianAgent**: контроль инвариантов, предотвращение регрессий.

## Stage 6 execution mapping (A-G)

Если в задаче указано “Stage 6 (chain + Anchor)”, то выполняй только свою секцию (букву A-G) из:

- `C:\diploma\docs\agents\stage6-prompts.md`

- `RefactorGuardianAgent` → **A**
- `ArchitectAgent` → **B**
- `DBPrismaAgent` → **C**
- `Web3SolanaAgent` → **D**
- `BackendAPIAgent` → **E**
- `FrontendAgent` → **F**
- `TestingCIAgent` и/или `DocsEditorAgent` → **G**

Примечание: маппинг A–G можно использовать и для следующих стадий (7–8), если в задаче “polish/perf/security/UX” указан один общий этап и вы выполняете секции из соответствующего `docs/agents/*-prompts.md`.

## Stage 7–8 execution mapping (A-G)

- Stage 7: `C:\diploma\docs\agents\stage7-prompts.md` — соответствие A–G см. в начале файла.
- Stage 8: `C:\diploma\docs\agents\stage8-prompts.md` — соответствие A–G см. в начале файла.

## Stage 9 execution mapping (A-G)

Если в задаче указано “Stage 9 (deployment + observability + operations)”, выполняй только свою секцию (букву A-G) из:

- `C:\diploma\docs\agents\stage9-prompts.md`

- `RefactorGuardianAgent` → **A**
- `ArchitectAgent` → **B**
- `DBPrismaAgent` → **C**
- `BackendAPIAgent` → **D**
- `FrontendAgent` → **E**
- `TestingCIAgent` → **F**
- `DocsEditorAgent` → **G**

## Stage 10 execution mapping (A-G)

Если в задаче указано “Stage 10 (security + observability production depth)”, выполняй только свою секцию (букву A-G) из:

- `C:\diploma\docs\agents\stage10-prompts.md`

- `RefactorGuardianAgent` → **A**
- `ArchitectAgent` → **B**
- `DBPrismaAgent` → **C**
- `BackendAPIAgent` → **D**
- `FrontendAgent` → **E**
- `TestingCIAgent` → **F**
- `DocsEditorAgent` → **G**

## Stage 11 execution mapping (A-G)

Если в задаче указано “Stage 11 (post-launch / production operations & scaling)”, выполняй только свою секцию (букву A-G) из:

- `C:\diploma\docs\agents\stage11-prompts.md`

- `RefactorGuardianAgent` → **A**
- `ArchitectAgent` → **B**
- `DBPrismaAgent` → **C**
- `BackendAPIAgent` → **D**
- `FrontendAgent` → **E**
- `TestingCIAgent` → **F**
- `DocsEditorAgent` → **G**

## Stage 12 execution mapping (A-G)

Если в задаче указано “Stage 12 (implementation of Stage 11 + governance / moderation baseline)”, выполняй только свою секцию (букву A-G) из:

- `C:\diploma\docs\agents\stage12-prompts.md`

- `RefactorGuardianAgent` → **A**
- `ArchitectAgent` → **B**
- `DBPrismaAgent` → **C**
- `BackendAPIAgent` → **D**
- `FrontendAgent` → **E**
- `TestingCIAgent` → **F**
- `DocsEditorAgent` → **G**

## UX / Globe phase execution mapping (A-G)

Если в задаче указано **«UX / Globe phase»** (кошелёк, 2D-карта, зум, светлая Земля, инфо о кабелях, легенда сети), выполняй только свою секцию из:

- **`docs/agents/ux-globe-phase-prompts.md`** — там же **общий промпт** для вставки в чат и секции **A–G**.

| Буква | Агент |
|-------|--------|
| **A** | RefactorGuardianAgent |
| **B** | ArchitectAgent |
| **C** | Web3SolanaAgent |
| **D** | ThreeLeafletAgent |
| **E** | FrontendAgent |
| **F** | BackendAPIAgent и ScriptsImportAgent |
| **G** | DocsEditorAgent и TestingCIAgent |

## Auth / Profile phase execution mapping (A-G)

Если в задаче указано **«Auth / Profile phase»** (username, личный кабинет, подпись кошельком), выполняй только свою секцию из:

- **`docs/agents/auth-profile-phase-prompts.md`** — общий промпт и секции **A–G**.

| Буква | Агент |
|-------|--------|
| **A** | RefactorGuardianAgent |
| **B** | ArchitectAgent |
| **C** | DBPrismaAgent |
| **D** | Web3SolanaAgent |
| **E** | BackendAPIAgent |
| **F** | FrontendAgent |
| **G** | DocsEditorAgent и TestingCIAgent |
