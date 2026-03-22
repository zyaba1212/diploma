# Архитектура

## 3D глобус (Земля)

Реалистичная планета: текстуры color/normal/specular + слой облаков (three.js examples), тон-маппинг ACES, сеть закреплена на `globeGroup` и вращается с планетой. Подробно: `docs/earth-visualization.md`.

## Модули

- **UI (Next.js App Router)**: `src/app`, `src/components`
- **API (Route Handlers)**: `src/app/api/*`
- **DB**: PostgreSQL + Prisma (`prisma/schema.prisma`, `src/lib/prisma.ts`)
- **Web3**: Phantom wallet + серверная проверка подписи
- **Data import**: node scripts в `scripts/*` (источники и bbox: [`docs/network-data-sources.md`](network-data-sources.md))

### Клиент: Phantom и autoconnect

`@solana/wallet-adapter-react` по умолчанию сохраняет выбранный кошелёк в `localStorage` (`walletName`). В приложении задана **политика сброса autoconnect**: после **30 минут** без активности пользователя на сайте (и при следующем заходе, если с последней метки активности прошло столько же времени) сохранённое подключение не используется для автоподключения; при явном **disconnect** предпочтение тоже очищается (поведение адаптера). Реализация: `src/lib/wallet-autoconnect-policy.ts`, `WalletStaleAutoconnectGuard`, `WalletIdleAutoconnect` в `src/app/providers.tsx`. Промпт для доработок: `docs/agents/wallet-autoconnect-prompt.md` (роль **Web3SolanaAgent**).

### Профиль: username (Auth / Profile)

- **Правила username:**
  - генерация и валидация соответствуют `src/lib/username.ts` (`validateUsernameFormat`);
  - формат: `3–32` символа, только латиница, цифры и `_`.
- **Авто-генерация на первом входе:**
  - в `POST /api/auth/verify` бекенд проверяет наличие записи `User`;
  - если у пользователя `username` ещё нет (или запись только что создана), бекенд генерирует **random username (уникальный)** и сохраняет в БД;
  - при авто-генерации выставляется `usernameSetAt = null`.
- **`usernameSetAt` — семантика прав на переопределение:**
  - `null` => username авто-сгенерирован, пользователь **может переопределить** username в `Cabinet`;
  - `!= null` => username задан пользователем, повторная смена username **запрещена** (если нет отдельной политики).
- **Доказательство владения (переопределение username):**
  - переопределение выполняется подписью off-chain сообщения на стороне сервера;
  - канон строки сообщения определяется `src/lib/username.ts` (`buildUsernameMessage`):
    - `diploma-z96a username\npubkey=<pubkey>\nusername=<username>\nts=<ts>`.
- **Публичные профили:**
  - `GET /api/profile?pubkey=` возвращает `{ username, usernameSetAt, inDatabase }`;
  - если записи ещё нет: `inDatabase: false`, `username=null`, `usernameSetAt=null`.
- **Установка username (только при авто-username):**
  - `POST /api/profile/username` принимает `{ publicKey, message, signature, username }`;
  - конфликт занятого username — `409`;
  - если `usernameSetAt != null`, сервер отклоняет установку как “смена не поддерживается” (403).
- UI: страница **`/cabinet`** показывает:
  - когда кошелёк не подключён — признак “подключите кошелёк”;
  - когда записи в БД нет — просьбу “Авторизовать” (после успешного `POST /api/auth/verify`);
  - форму переопределения только при `usernameSetAt === null`;
  - после `POST /api/auth/verify` фронт диспатчит `auth:verified` и инициирует refetch профиля.
  - детали фазы: `docs/agents/auth-profile-phase-prompts.md`.

## Потоки данных

```mermaid
flowchart TD
  ui[UI(React)] -->|"fetch"| api[API(RouteHandlers)]
  api -->|"PrismaClient"| db[(PostgreSQL)]

  ui -->|"signMessage"| wallet[PhantomWallet]
  ui -->|"POST /api/auth/verify"| api
  api -->|"verify(tweetnacl+bs58)"| api
  api -->|"upsert User"| db
```

## Контракты API (коротко)

- **Network**: `GET /api/network?scope=GLOBAL|LOCAL&bbox=minLat,minLng,maxLat,maxLng` → `{ providers, elements }`
- **Auth**: `POST /api/auth/verify` body `{ publicKey, message, signature }` → `{ ok: true }`
- **Profile**: `GET /api/profile?pubkey=` → данные пользователя / `inDatabase`; `POST /api/profile/username` — установка username подписью
- **Tiles/Geocode**: прокси к внешним источникам для Leaflet

## Operations & Deployment (Stage 9)

Операционные инварианты, deployment topology, SLO-lite, runbooks (startup/shutdown/incident) и env matrix зафиксированы в `docs/operations.md`.

Политика секретов и GO/NO-GO перед релизом: `docs/secrets-policy.md`, `docs/release-hardening.md`. Проверка готовности к откату: `npm run ops:rollback-drill`.

## Security & observability (Stage 10)

Stage 10 фиксирует production-depth hardening без изменения публичных API-контрактов Stage 5-8.

Текущее состояние (по фактическому коду):
- observability baseline: structured logs `api_metric` для ключевых endpoints (`/api/health`, `submit`, `apply`, `rollback`);
- operational safety: `GET /api/health` + in-memory rate limiting на proposals/tile/geocode endpoints;
- secrets/release policy: `docs/secrets-policy.md` и `docs/release-hardening.md`.

Документы Stage 10:
- security + observability задачи по агентам: `docs/agents/stage10-prompts.md`;
- threat model + security headers + observability policy: `docs/stage10-security-observability.md`;
- operations/runbooks/env: `docs/operations.md`;
- релизные критерии GO/NO-GO: `docs/release-hardening.md`;
- политика секретов/PII: `docs/secrets-policy.md`.

## Stage 11 (post-launch)

Архитектурная схема scaling + incident definition для продакшена:
- `docs/stage11-post-launch-architecture.md`

## Stage 12 (implementation + governance) — done

Закрывает разрыв «задокументировано в Stage 11» ↔ «работает в проде» и добавляет baseline governance/moderation.

По факту реализации на текущем коде:
- Shared rate limit state: реализован “Redis-ready” режим в `src/lib/rateLimit.ts`. При `RATE_LIMIT_BACKEND=redis` и `REDIS_URL` backend использует Redis, иначе деградирует в in-memory режим. Контракт ответа `429 { error: "rate limit exceeded" }` сохраняется.
- Body size / mutation guards: единая политика body size на всех mutation routes proposals пока не выделена; базовый guard по `elementPayload` реализован только в `POST /api/proposals/:id/actions`.
- Moderation / governance endpoints: реализован `POST /api/moderation/proposals/:id/decide`; allowlist задаётся `MODERATOR_PUBKEYS` (comma-separated base58). Endpoint использует optional Phantom-signature verify (только если в body передан `signature`), rate-limit key `moderation.decide:<clientIp>` и body size guard по `content-length` (ошибка: `400 { error: "payload too large" }`).
- Observability/SLO: health-check и structured logs `api_metric` описаны в `docs/operations.md`; moderation endpoint также пишет `api_metric` через `logApiMetric`.

Документы Stage 12:
- scope: `docs/stage12-scope.md`
- runbooks/ops: `docs/operations.md`
- промпты по ролям (A–G): `docs/agents/stage12-prompts.md`

## Stage 5–7 (эскиз)

Подробности: `docs/stage5plus.md`.

```mermaid
flowchart TD
  uiPropose[UI(ProposeMode)] -->|"POST /api/proposals"| apiPropose[API(Proposals)]
  apiPropose -->|"store Proposal (DRAFT)"| db[(PostgreSQL)]
  uiPropose -->|"POST /api/proposals/:id/submit"| apiSubmit[API(Proposals)]
  apiSubmit -->|"verify signature + txSignature (mock in dev)"| uiPropose
```

### Поток данных Propose‑mode

Фокус: взаимодействие UI режима Propose с `/api/proposals/*` и БД.

1. **UI (Propose‑mode)**  
   - Пользователь в отдельном режиме (`/propose` или эквивалентный экран) формирует предложение изменений сети.  
   - UI получает текущую сеть через существующий `GET /api/network` (инвариант, не меняется).  
   - При первом сохранении создаётся `Proposal` со статусом `DRAFT`.

2. **API `/api/proposals/*`**  
   - UI отправляет запросы в backend‑маршруты `src/app/api/proposals/*`:
    - создание предложения (`POST /api/proposals`);
    - просмотр предложений (`GET /api/proposals` и `GET /api/proposals/:id`).
  - Перевод в `SUBMITTED` и работа с `ChangeAction` (редактор действий) на минимальном Stage 5 пока не реализованы; Stage 6 `submit` требует, чтобы в БД уже стоял `status = SUBMITTED`.  
   - API‑слой:
    - валидирует payload и создаёт/читает записи `Proposal` через Prisma.

3. **БД (PostgreSQL + Prisma)**  
   - Хранит:
     - таблицу предложений (`Proposal`),
     - связанные действия (`ChangeAction`),
     - историю применённых действий (`HistoryEntry`) на последующих стадиях.  
   - На Stage 5 изменения сети могут применяться через отдельный apply‑шаг API (например, `POST /api/proposals/:id/apply`), который:
     - читает `Proposal` и его действия,
     - транзакционно применяет изменения к “активной” модели сети (таблицы элементов/провайдеров),
     - записывает историю (на Stage 7).

### Stage 7: actions → apply/history/rollback contract

Подробный контракт Stage 7 фиксирован в `docs/stage7.md`:
- `POST /api/proposals/:id/actions` — добавление `ChangeAction` в Proposal (минимальная авторизация через Phantom signature).
- `POST /api/proposals/:id/apply` — применение принятого предложения к активной сети и запись `HistoryEntry` с `diff` по стратегии snapshot-before-apply.
- `POST /api/proposals/:id/rollback` — откат последнего apply для Proposal, используя `HistoryEntry.diff`.
- `GET /api/proposals/:id/history` — список history entries для UI/админки.

На v1: `POST /api/proposals/:id/apply` создаёт отдельную `HistoryEntry` по одному на `ChangeAction`, а `POST /api/proposals/:id/rollback` принимает только `signature` (backend выбирает последнюю `HistoryEntry`, откатывает её `diff` и обновляет `Proposal.status`).

Для быстрой верификации предусмотрены smoke-тесты: `npm run test:proposals-stage7` (см. `docs/stage7.md`).

Инварианты существующих контрактов (`/api/network`, `/api/auth/*`, `/api/tile`, `/api/geocode/*`) сохраняются; Propose‑mode добавляет новые маршруты `/api/proposals/*`, не изменяя их сигнатуры.

### Stage 6: on-chain submission (Anchor)

После того, как предложение имеет `status = SUBMITTED` (Stage 5), UI выполняет on-chain фиксацию:

```mermaid
flowchart TD
  ui[UI(ProposeMode)] -->|"sign message диплома + contentHash"| uiSign[Phantom signMessage]
  uiSign -->|"POST /api/proposals/:id/submit"| apiSubmit[API(Proposals)]
  apiSubmit -->|"recompute/verify contentHash + verify signature"| apiVerify[Signature verifier]
  apiVerify -->|"send Memo tx (dev mock txSignature)"| solana[Solana/Anchor]
  solana -->|"txSignature"| apiSubmit
  apiSubmit -->|"persist onChainTxSignature / onChainSubmittedAt"| db[(PostgreSQL)]
  apiSubmit -->|"return { txSignature }"| ui
```

Ключевые детали контракта:

- `contentHash` и stable-hash правила: используются те же канонизация/`stable stringify`, что описаны в `docs/stage5plus.md`:
  - JSON с детерминированным порядком ключей (stable stringify / сортировка ключей);
  - `contentHash` вычисляется как `sha256(UTF8(stableJson(canonicalInput)))` по canonicalInput из Stage 6 v1 (см. `docs/stage5plus.md`).
- В UI для Stage 5 minimum считается `actions = []`; ключи `title`/`description` включаются только если `Proposal.title`/`Proposal.description` не равны `null` (если `null` — ключи отсутствуют).
- Новый endpoint:
  - `POST /api/proposals/:id/submit`
  - Request body: `{ signature: string, contentHash?: string }`
  - Response: `{ txSignature: string }`

Backend гарантирует, что:

- предложение существует и находится в `SUBMITTED`;
- `contentHash` согласован:
  - с уже сохранённым `Proposal.contentHash` (если он задан),
  - с `contentHash` из запроса (если он передан);
- подпись проверяется по `Proposal.authorPubkey` для message `diploma-z96a propose:<contentHash>`;
- в `dev` возвращается mock `txSignature`;
- на success backend сохраняет в БД `contentHash`, `signature`, `onChainTxSignature` и `onChainSubmittedAt`.

### Модель данных: сеть и предложения

На уровне Prisma (см. `prisma/schema.prisma`) сеть и предложения описываются следующими сущностями:

- `User`
  - `id: String @id @default(cuid())`
  - `pubkey: String @unique` — публичный ключ Phantom‑кошелька; логически используется как автор предложений.

- `NetworkProvider`
  - провайдер сети с полем `scope: Scope` (`GLOBAL | LOCAL`) и связью `elements: NetworkElement[]`.

- `NetworkElement`
  - элемент сети (кабель, базовая станция и т.п.) с полями положения (`lat`, `lng`, `altitude`), типом `NetworkElementType` и опциональным `providerId` → `NetworkProvider`.
  - поле `sourceId` остаётся уникальным инвариантом для дедупликации импортируемых элементов.

- `Proposal`
  - единица предложения изменений сети.
  - ключевые поля:
    - `scope: Scope` — `GLOBAL | LOCAL`, синхронизировано с моделью сети;
    - `authorPubkey: String` — публичный ключ автора, логически ссылается на `User.pubkey` (без жёсткого FK);
    - `status: ProposalStatus` (`DRAFT | SUBMITTED | ACCEPTED | REJECTED` на текущем этапе; enum также включает `APPLIED | CANCELLED` для будущих переходов);
    - опциональные текстовые поля `title?`, `description?`;
    - Stage 6 submission facts (хранятся опционально, чтобы Stage 5 draft creation не ломался):
      - `contentHash?: string`
      - `signature?: string` (base58, подпись автора по `contentHash`)
      - `onChainTxSignature?: string`
      - `onChainSubmittedAt?: Date`
    - временные метки: `createdAt`, `updatedAt`, `submittedAt?`, `decidedAt?`.
  - связи:
    - `actions: ChangeAction[]` — одно `Proposal` содержит множество связанных действий `ChangeAction`.

- `ChangeAction`
  - отдельное действие в рамках предложения.
  - ключевые поля:
    - `proposalId: String` → `Proposal.id` (один Proposal → много ChangeAction);
    - `actionType: ChangeActionType` (`CREATE | UPDATE | DELETE`);
    - `targetElementId?: String` → `NetworkElement.id` — целевой элемент сети для `UPDATE`/`DELETE` (опционально для `CREATE`);
    - `elementPayload: Json` — канонический payload элемента/патча в терминах текущей модели сети;
    - `reversePayload?: Json` — данные для обратного применения действия (за‑дел для истории/отката);
    - `createdAt: DateTime`.

Связи между сущностями в БД можно описать так:

```mermaid
erDiagram
  User {
    String id
    String pubkey
  }

  NetworkProvider {
    String id
    String name
    Scope  scope
  }

  NetworkElement {
    String id
    Scope  scope
    String? providerId
    String? sourceId
  }

  Proposal {
    String id
    Scope  scope
    String authorPubkey
    ProposalStatus status
    String? contentHash
    String? signature
    String? onChainTxSignature
    DateTime? onChainSubmittedAt
    String? title
    String? description
    DateTime createdAt
    DateTime updatedAt
    DateTime? submittedAt
    DateTime? decidedAt
  }

  ChangeAction {
    String id
    String proposalId
    ChangeActionType actionType
    String? targetElementId
  }

  NetworkProvider ||--o{ NetworkElement : "elements"
  Proposal ||--o{ ChangeAction : "actions"
  NetworkElement ||--o{ ChangeAction : "target (logical)" 
  User ||--o{ Proposal : "author (by pubkey, logical)"
```

`/api/network` по‑прежнему читает только активную сеть из `NetworkProvider`/`NetworkElement` и не зависит напрямую от `Proposal`/`ChangeAction`; новые сущности используются в Propose‑mode и движке применения изменений.

## Stage 9 ops safeguards

- Health endpoint: `GET /api/health`
  - проверяет доступность app + DB (`SELECT 1` через Prisma);
  - success: `{ ok: true, app: "ok", db: "ok" }`;
  - failure: `{ error: "health check failed" }` и status `503`.
- Rate limits (in-memory, best-effort, per process/per IP):
  - `POST /api/proposals/:id/submit`: 15 req/min
  - `POST /api/proposals/:id/actions`: 20 req/min
  - `POST /api/proposals/:id/apply`: 10 req/min
  - `POST /api/proposals/:id/rollback`: 10 req/min
  - `GET /api/proposals/:id/history`: 60 req/min
  - `GET /api/tile`: 300 req/min
  - `GET /api/geocode/search`: 60 req/min
  - `GET /api/geocode/reverse`: 60 req/min
- Structured API metrics logs (`type: "api_metric"`) пишутся на ключевых mutation endpoints (`submit/apply/rollback`) и `health`:
  - поля: `route`, `method`, `status`, `durationMs`, `ok`, `note?`.

## Stage 10 security + observability depth

- Security headers (global, через `next.config.mjs`):
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Frame-Options: SAMEORIGIN`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- API hardening:
  - для ключевых 5xx на mutation endpoints (`/api/proposals/:id/submit|apply|rollback`, `actions`) используется единая форма ошибки с correlation id:
    - `{ error: string, correlationId: string }`
  - response header `x-correlation-id` дублирует id для трассировки инцидентов.
- Rate limits (актуально):
  - `POST /api/proposals/:id/submit`: 15 req/min
  - `POST /api/proposals/:id/actions`: 20 req/min
  - `POST /api/proposals/:id/apply`: 10 req/min
  - `POST /api/proposals/:id/rollback`: 10 req/min
  - `GET /api/proposals/:id/history`: 60 req/min
  - `GET /api/tile`: 300 req/min
  - `GET /api/geocode/search`: 60 req/min
  - `GET /api/geocode/reverse`: 60 req/min

## Stage 11 post-launch operations & scaling

Stage 11 закрепляет production-эксплуатацию без изменения публичных API-контрактов Stage 5–8.

Ориентиры:
- Основные runbooks и инварианты production: `docs/operations.md` (раздел `Post-launch (Stage 11)`).
- Политика секретов: `docs/secrets-policy.md`.
- GO/NO-GO и readiness: `docs/release-hardening.md`.

## Stage 11 post-launch: scaling + maturity

После релиза целевой профиль нагрузки, требования к shared state при multi-instance (Redis для distributed rate limit) и правила алертов фиксируются в `docs/operations.md` (секция `Stage 11 (post-launch): production scaling + maturity`).

