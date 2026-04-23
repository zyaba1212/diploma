# Project Overview (для агентов)

Этот документ — **единая точка входа** для любого агента/ассистента, которого посадили работать с репозиторием `diploma-z96a`. Цель — дать полную картину проекта без повторной «разведки»: что это, как устроено, где что лежит, какие инварианты нельзя ломать. Если ты новый агент в чате — прочитай этот файл целиком **до** любых изменений.

Связанные, более узкие документы: `AGENTS.md`, `PROJECT_STAGES.md`, `README.md`, `docs/architecture.md`, `docs/requirements.md`, `DEVELOPMENT_JOURNAL.md`.

---

## 1. Что это за проект

**`diploma-z96a`** — дипломный WEB3-проект на **Next.js 15 (App Router) + TypeScript**, посвящённый теме:

> **«Архитектура систем транзакций в условиях частичного отсутствия интернета».**

Мотивация (из `src/components/HomePage.tsx`):

- **Проблема**: в 2024 году ураган в Мозыре (Беларусь) привёл к трёхдневной потере связи; к 2026 году вводится цифровой рубль — гражданам нужен надёжный доступ к транзакциям даже при отказах сети.
- **Решение**: отказоустойчивая архитектура — **mesh-сети**, ретрансляция через **2G/SMS**, **офлайн-очереди транзакций**, резерв через **VSAT**.

Что делает платформа:

1. Визуализирует мировую инфраструктуру связи на **3D-глобусе (Three.js)** и **2D-карте (Leaflet)** с бесшовным переключением.
2. Авторизует пользователей через **Phantom (Solana)** по подписи сообщения.
3. Позволяет создавать **предложения изменений сети** (`Proposal / ChangeAction`) с **on-chain фиксацией contentHash** (Stage 6 Memo-tx + задел под Anchor).
4. Поддерживает **голосование** (`Vote`) и **модерацию** (запись `ModeratorGrant` в БД и/или env `MODERATOR_PUBKEYS` *deprecated*, аудит в `ModerationDecision`); **админ-панель** `/admin` — серверная staff-сессия (httpOnly cookie), роли `ADMIN` / `MODERATOR`, журнал `AuditLog`, бан пользователей, управление предложениями и новостным кэшем (см. [`stage13-admin-panel.md`](stage13-admin-panel.md)).
5. Дополнительно — **personal cabinet** с уникальным `username` и **лента новостей** (`NewsCache`).

---

## 2. Роли агентов

Подробно в `AGENTS.md`. Кратко:

- **ArchitectAgent** — архитектура, инварианты, документация.
- **FrontendAgent** — Next.js UI (`src/app`, `src/components`).
- **ThreeLeafletAgent** — 3D/2D визуализация, lifecycle карт, производительность.
- **BackendAPIAgent** — route handlers `src/app/api/*`, кеширование, безопасность.
- **DBPrismaAgent** — `prisma/schema.prisma`, миграции, индексы, сид.
- **Web3SolanaAgent** — Phantom auth, позже Anchor / tx flow.
- **ScriptsImportAgent** — скрипты импорта данных в БД (`scripts/*`).
- **TestingCIAgent** — тесты, линт, CI.
- **DocsEditorAgent** — актуализация `docs/*`, `README.md`.
- **RefactorGuardianAgent** — контроль инвариантов, предотвращение регрессий.

На стадиях Stage 6–12 и UX/Globe/Auth-Profile фазах действует mapping **A–G** (см. `AGENTS.md` + `docs/agents/*-prompts.md`). Буква A–G определяется ролью агента.

Координация между ролями ведётся человеком / чеклистом в `DEVELOPMENT_JOURNAL.md`. Правила чата координатора — `.cursor/rules/coordinator-architect.mdc`.

---

## 3. Стек и ключевые зависимости

Из `package.json`:

- **Runtime/Framework**: `next@^15.5`, `react@^18.3`, `typescript@^5.8`.
- **БД / ORM**: `@prisma/client`, `prisma` (PostgreSQL).
- **Web3 / Solana**: `@solana/web3.js`, `@solana/wallet-adapter-{base,react,react-ui,wallets}`, `tweetnacl` + `bs58` для верификации подписи.
- **3D / 2D**: `three@^0.178` (+ `@types/three`), `leaflet@^1.9` (+ `@types/leaflet`).
- **Спутники**: `satellite.js` (TLE/orbit propagation).
- **Инфраструктура**: `redis` (shared rate-limit на Stage 12), `pino-pretty` (logs).
- **Dev**: ESLint (`eslint-config-next`), Prettier, `tsx`.

`next.config.mjs`:

- Global security headers: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`.
- `Cache-Control: no-store` для всех `/api/*`.
- Windows-friendly webpack (in-memory cache в dev, watch ignore `.next`, `node_modules`, `DrWeb Quarantine` и др.).
- `allowedDevOrigins: ['z96a.xyz', 'www.z96a.xyz']`.
- `experimental.devtoolSegmentExplorer: false` (избегаем 500 на `/cabinet` в dev).

---

## 4. Структура каталогов

```
diploma/
├── anchor/                     # задел под Solana Anchor-программы
├── prisma/
│   ├── schema.prisma           # модели БД
│   ├── migrations/             # Prisma migrations
│   └── seed.mjs
├── public/
├── data/                       # импортные данные
├── db-export/
├── scripts/                    # импорт данных, smoke-тесты, ops
├── docs/                       # вся архитектура и стадии (Stage 0–12)
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── layout.tsx, page.tsx, providers.tsx, globals.css
│   │   ├── about/, cabinet/, cables/, global-network/,
│   │   ├── moderate/, networks/, networks/[id]/,
│   │   ├── news/, predlozhit/, propose/, sandbox/
│   │   └── api/                # Route handlers (подробно в §7)
│   ├── components/             # React-компоненты
│   │   ├── ui/                 # Button, Loading, Panel
│   │   ├── SiteHeader, HomePage, AuthBlock,
│   │   ├── EarthScene.tsx      # главный 3D-глобус
│   │   ├── MapView.tsx         # Leaflet-карта
│   │   ├── GlobalNetworkPage.tsx
│   │   └── WalletIdleAutoconnect, WalletStaleAutoconnectGuard
│   ├── contexts/
│   ├── hooks/useAuthorPubkey.ts
│   └── lib/
│       ├── prisma.ts, types.ts
│       ├── apiError.ts, apiOps.ts, bodySizeGuard.ts,
│       ├── circuitBreaker.ts, rateLimit.ts (Redis-ready)
│       ├── geocodeCache.ts, earthQuality.ts, loadEarthTextures.ts
│       ├── username.ts, wallet-autoconnect-policy.ts, ui-root.ts
│       ├── moderation/decideProposal.ts
│       ├── stage6/proposalSubmission.ts
│       ├── stage7/{historyStore.ts, networkElementOps.ts}
│       └── three/{factories, globeAppearance, globeMapSync, labels, utils}.ts
├── AGENTS.md, PROJECT_STAGES.md, README.md, DEVELOPMENT_JOURNAL.md
└── next.config.mjs, tsconfig.json, vercel.json, .eslintrc.cjs, .prettierrc
```

---

## 5. Модель данных (Prisma)

Источник истины: `prisma/schema.prisma`. База — PostgreSQL.

### Enums

- `Scope` — `GLOBAL | LOCAL`.
- `ProposalStatus` — `DRAFT | SUBMITTED | ACCEPTED | REJECTED | APPLIED | CANCELLED`.
- `ChangeActionType` — `CREATE | UPDATE | DELETE`.
- `VoteType` — `FOR | AGAINST`.
- `NetworkElementType` — кабели (`CABLE_COPPER`, `CABLE_FIBER`, `CABLE_UNDERGROUND_COPPER`, `CABLE_UNDERGROUND_FIBER`), узлы (`SERVER`, `SWITCH`, `MULTIPLEXER`, `DEMULTIPLEXER`, `REGENERATOR`, `MODEM`), `BASE_STATION`, `SATELLITE`, `SATELLITE_RASSVET`, `EQUIPMENT`, + **offline-transaction-specific**: `MESH_RELAY`, `SMS_GATEWAY`, `VSAT_TERMINAL`, `OFFLINE_QUEUE`.

### Модели

- **`User`** — `pubkey` (unique). Опциональный `username` (unique) + `usernameSetAt`. Опционально `moderatorGrant` (1:1) — право решать в `/api/moderation/*` и входить в админку как `MODERATOR`. Stage 13: `bannedAt?`, `bannedReason?`.
  - `usernameSetAt == null` ⇒ username авто-сгенерирован, **можно переопределить** (через подпись).
  - `usernameSetAt != null` ⇒ переопределение **запрещено** (403).
- **`StaffSession`** — серверная сессия для `/admin`: `tokenHash` (SHA-256 от opaque-токена из cookie), `role` (`ADMIN` \| `MODERATOR`), `pubkey?` (для входа через Phantom), `expiresAt`.
- **`ModeratorGrant`** — `userId` (PK/FK → `User`): кошелёк уже есть в БД; `grantedAt`, опционально `grantedByStaffSessionId`.
- **`NetworkProvider`** — `name + scope`, связь `elements: NetworkElement[]`.
- **`NetworkElement`** — `type`, `scope`, `providerId?`, `lat/lng/altitude?`, `path: Json?` (для кабелей), `metadata: Json?`, `sourceId?` (unique, для дедупликации импорта). Индексы под geo-запросы: `[scope]`, `[scope, type]`, `[scope, lat, lng]`, `[type]`, `[lat, lng]`.
- **`Proposal`** — `scope`, `authorPubkey` (логически ссылается на `User.pubkey`), `status`, `title?`, `description?`, `pinned`, временные метки. Stage 6 submission facts (опциональны): `contentHash?`, `signature?` (base58), `onChainTxSignature?`, `onChainSubmittedAt?`. Stage 13: `cancelledByStaffSessionId?`, `cancelReason?`, `rejectionReason?`. Связи: `actions: ChangeAction[]`, `votes: Vote[]`, `moderationDecision?`, `feedbacks: ProposalFeedback[]`. Много индексов.
- **`ChangeAction`** — `proposalId`, `actionType`, `targetElementId?`, `elementPayload: Json`, `reversePayload: Json?`.
- **`HistoryEntry`** — Stage 7 apply/rollback: `proposalId`, `actionId`, `appliedByPubkey?`, `appliedAt`, `diff: Json` (снепшот, достаточный для отката).
- **`ModerationDecision`** (Stage 12) — `proposalId` (unique), `moderatorPubkey`, `fromStatus → toStatus`, `decidedAt`, `decisionSignature?`, `comment?` (Stage 13).
- **`AuditLog`** (Stage 13) — действия staff: `action`, `actorType`, `staffSessionId?`, `actorPubkey?`, `targetType?`, `targetId?`, `meta` (Json), `at`.
- **`ProposalFeedback`** (Stage 13) — текст обратной связи модератора к предложению.
- **`Vote`** — уникален per `(proposalId, voterPubkey)`, `voteType`, обязательная `signature`, опциональная `txSignature`.
- **`NewsCache`** — кеш внешних новостей (`url` unique, `publishedAt`, `source`).

---

## 6. Страницы (App Router, `src/app`)

- `/` — **HomePage**: hero-заголовок про тему диплома, панели «Проблема»/«Решение», карточки фич.
- `/about` — об авторе/проекте.
- `/global-network` — **основная визуализация** 3D/2D (`GlobalNetworkPage` → `EarthScene` + `MapView`). Алиас `/cables` оставлен для совместимости.
- `/sandbox` — «песочница» для сборки и тестирования своих архитектурных предложений.
- `/networks` — список предложений; `/networks/[id]` — детали и голосование.
- `/propose` — создание предложения изменения сети (+ алиас `/predlozhit`).
- `/news` — лента новостей (из `NewsCache`).
- `/cabinet` — личный кабинет: показывает `username`, позволяет переопределить только если `usernameSetAt === null`, подпись кошельком.
- `/moderate` — **редирект** на `/admin/moderation` (старый Phantom-UI заменён staff-очередью в админке).
- `/admin` — при валидной staff-сессии редирект на `/admin/overview`; без сессии → `/admin/login`.
- `/admin/login` — вход только через Phantom: подпись nonce (`GET /api/admin/auth/nonce`); `ADMIN_WALLET_PUBKEY` → роль `ADMIN`, иначе при праве модератора → `MODERATOR`.
- `/admin/overview`, `/admin/users`, `/admin/moderators`, `/admin/proposals`, `/admin/moderation`, `/admin/sessions`, `/admin/audit`, `/admin/news` — см. [`stage13-admin-panel.md`](stage13-admin-panel.md).

Глобальная оболочка — `src/app/layout.tsx` + `Providers` (`ConnectionProvider` / `WalletProvider` с `PhantomWalletAdapter` / `WalletModalProvider` + `WalletIdleAutoconnect` + `WalletStaleAutoconnectGuard`) + `SiteHeader` (fixed header, центрированная навигация, Phantom connect, dropdown «Личный кабинет / Отключить», мобильный hamburger, условная ссылка «Админка» при активной staff-сессии).

---

## 7. API (`src/app/api/**/route.ts`)

### Auth / Profile

- `POST /api/auth` и `POST /api/auth/verify` — проверка подписи через `tweetnacl + bs58`, `upsert User`; при первом входе backend **авто-генерирует уникальный `username`** (`usernameSetAt = null`).
- `GET /api/profile?pubkey=` → `{ username, usernameSetAt, inDatabase }`. Если записи ещё нет: `inDatabase: false`, поля `null`.
- `POST /api/profile/username` — установка username подписью сообщения `diploma-z96a username\npubkey=<pk>\nusername=<u>\nts=<ts>` (см. `src/lib/username.ts`, `buildUsernameMessage`). 409 при конфликте, 403 если `usernameSetAt != null`.
- `GET /api/profile/bulk` — массовый lookup по нескольким pubkey.

### Admin (staff session, httpOnly `diploma_staff_session`)

- `GET /api/admin/auth/nonce` — подписанный nonce для входа кошельком (+ rate-limit; нужен `STAFF_SESSION_SECRET`, длина ≥ 16).
- `POST /api/admin/login/wallet` — `{ publicKey, message, signature, nonce }`; `message` строго `diploma-z96a admin-login\nnonce=<nonce>`; если `publicKey === ADMIN_WALLET_PUBKEY` → роль `ADMIN`, иначе при наличии права модератора (`ModeratorGrant` или `MODERATOR_PUBKEYS`) → `MODERATOR`.
- `POST /api/admin/logout` — сброс сессии.
- `GET /api/admin/me` — `{ ok, role, pubkey }` или 401.
- `GET/POST /api/admin/moderators`, `DELETE /api/admin/moderators/[pubkey]` — только `ADMIN` (+ аудит).
- `GET /api/admin/users`, `POST/DELETE .../users/[pubkey]/ban` — staff (`ADMIN` или `MODERATOR`); кнопка «Назначить модератором» в UI — только у `ADMIN`.
- `GET /api/admin/proposals`, `GET/PATCH /api/admin/proposals/[id]`, `POST .../force-rollback` — см. [`stage13-admin-panel.md`](stage13-admin-panel.md).
- `POST /api/admin/moderation/[id]/decide`, `GET /api/admin/moderation-decisions` — staff-модерация.
- `GET/DELETE /api/admin/sessions*`, `GET /api/admin/audit-log`, `GET /api/admin/stats` — staff; `GET/POST/DELETE /api/admin/news*` — см. stage13 doc.

### Network data

- `GET /api/network?scope=GLOBAL|LOCAL&bbox=minLat,minLng,maxLat,maxLng` → `{ providers, elements }` (**инвариант контракта**).
- `GET /api/network/elements/[id]` — детали элемента для карточки кабеля/узла.

### Proposals (Stage 5–8)

- `POST /api/proposals` — создать Proposal в `DRAFT`.
- `GET /api/proposals` — список с фильтром по `status`, `authorPubkey`.
- `GET /api/proposals/[id]` — детали.
- `POST /api/proposals/[id]/submit-draft`, `.../submit`, `.../submit-onchain` — перевод в `SUBMITTED` и on-chain фиксация (Stage 6). В dev/test — `dev-tx-...` mock signature, в prod — Memo-tx на Solana.
  - Контракт submit: `{ signature, contentHash? }` → `{ txSignature }`. Сообщение: `diploma-z96a propose:<contentHash>`. Если `onChainTxSignature` уже сохранён — возвращается существующий.
- `POST /api/proposals/[id]/actions` — добавить `ChangeAction` (`bodySizeGuard` на `elementPayload`).
- `POST /api/proposals/[id]/apply` — применить к live-сети + записать `HistoryEntry` (один на `ChangeAction`, snapshot-before-apply).
- `POST /api/proposals/[id]/rollback` — откатить последнюю `HistoryEntry` по `Proposal`.
- `GET /api/proposals/[id]/history` — список history entries.
- `POST /api/proposals/[id]/vote` — голосование `FOR/AGAINST` (unique per voterPubkey).
- `POST /api/proposals/[id]/sync-actions` — синхронизация actions (новый маршрут, в активной разработке).

### Moderation (Stage 12)

- `POST /api/moderation/proposals/[id]/decide` (+ legacy `/api/moderation/[id]/decide`, `/api/moderation/decide`) — pubkey модератора допустим, если есть запись **`ModeratorGrant`** для соответствующего `User` **или** pubkey в env **`MODERATOR_PUBKEYS`** (comma-separated base58). Опциональная Phantom-подпись. Пишет `ModerationDecision` и `api_metric`. Body size guard + rate-limit key `moderation.decide:<clientIp>`.
- UI: очередь в `/admin/moderation`; legacy `/moderate` редиректит туда.

### Ops / integrations

- `GET /api/health` → `{ ok: true, app: "ok", db: "ok" }` или `503 { error: "health check failed" }`. Делает `SELECT 1` через Prisma.
- `GET /api/tile?z&x&y&source=osm|...` — прокси тайлов для Leaflet.
- `GET /api/geocode/search?q=`, `GET /api/geocode/reverse?lat&lng=`, `GET /api/geocode/nearby` — прокси с кешем (`geocodeCache.ts`) и circuit breaker.
- `GET /api/news` — агрегация новостей из `NewsCache`/внешних источников.

### Общая инфраструктура API

- **`src/lib/rateLimit.ts`** — Redis-ready rate-limit (`RATE_LIMIT_BACKEND=redis` + `REDIS_URL`), fallback in-memory. Контракт ответа: `429 { error: "rate limit exceeded" }`.
- **`src/lib/apiError.ts`** — единая форма 5xx: `{ error, correlationId }` + заголовок `x-correlation-id` (Stage 10).
- **`src/lib/bodySizeGuard.ts`** — защита от больших payload.
- **`src/lib/circuitBreaker.ts`** — для внешних прокси.
- **`src/lib/apiOps.ts`** — structured `api_metric` логи (`route`, `method`, `status`, `durationMs`, `ok`, `note?`) на ключевых endpoint-ах.

### Rate-limits (актуальные значения)

- `POST /api/proposals/:id/submit` — 15 req/min
- `POST /api/proposals/:id/actions` — 20 req/min
- `POST /api/proposals/:id/apply` — 10 req/min
- `POST /api/proposals/:id/rollback` — 10 req/min
- `GET /api/proposals/:id/history` — 60 req/min
- `GET /api/tile` — 300 req/min
- `GET /api/geocode/search` — 60 req/min
- `GET /api/geocode/reverse` — 60 req/min

---

## 8. Web3 / Phantom

- Провайдеры клиента: `src/app/providers.tsx` — `ConnectionProvider` (`NEXT_PUBLIC_SOLANA_RPC` или `https://api.devnet.solana.com`) + `WalletProvider` с `PhantomWalletAdapter` + `WalletModalProvider`.
- **Autoconnect policy** (`src/lib/wallet-autoconnect-policy.ts` + `WalletIdleAutoconnect` + `WalletStaleAutoconnectGuard`): предпочтение `walletName` сбрасывается после **30 мин** бездействия (и между визитами), а также при явном `disconnect`. Подробный промпт — `docs/agents/wallet-autoconnect-prompt.md`.
- `src/hooks/useAuthorPubkey.ts` — единая точка получения текущего `publicKey`.
- Подписи сообщений:
  - auth: `diploma-z96a auth\npubkey=<pk>\nts=<ts>`;
  - username: `buildUsernameMessage` из `src/lib/username.ts` (`diploma-z96a username\npubkey=<pk>\nusername=<u>\nts=<ts>`);
  - admin wallet login: `diploma-z96a admin-login\nnonce=<nonce>` (nonce из `GET /api/admin/auth/nonce`);
  - propose submit: `diploma-z96a propose:<contentHash>` (stable JSON + sha256).
- `anchor/` — задел под будущие Anchor-программы.

### Username правила

- Формат: `3–32` символа, только латиница, цифры, `_`. Валидация — `validateUsernameFormat` в `src/lib/username.ts`.
- Генерация/переопределение/семантика `usernameSetAt` — см. §5 и `docs/architecture.md`.

---

## 9. 3D/2D визуализация

- **Three.js**: `src/components/EarthScene.tsx` (~63 KB) — основной globe: камера, overlay сети, `globeGroup` (сеть привязана к вращению планеты), локальные подписи, тон-маппинг ACES.
- **Leaflet**: `src/components/MapView.tsx` — 2D-карта через API-прокси тайлов, гео-поиск.
- `src/lib/three/`:
  - `factories.ts` — фабрики мешей (кабели/узлы/спутники).
  - `labels.ts` — подписи.
  - `globeAppearance.ts` — осветление/экспозиция/эмиссив-fallback (UX/Globe phase).
  - `globeMapSync.ts` — конверсия 3D ↔ 2D center для бесшовного переключения режимов.
  - `utils.ts`, `earthQuality.ts`, `loadEarthTextures.ts` — офлайн-фолбэки текстур.
- Спутники рендерятся через `satellite.js` по TLE; источник — Celestrak (`scripts/sync-satellites-tle-celestrak.mjs`).

### UX-инварианты 3D/2D

- Переключение только вручную (кнопки `3D` и `2D`), **без zoom-based авто-переходов**.
- `3D -> 2D`: Leaflet центрируется в mid-point текущего `globeGroup`.
- `2D -> 3D`: `globeGroup` ориентируется так, чтобы текущий Leaflet center соответствовал центру 3D-камеры.
- Зум контролируется колесом/тачпадом, есть clamp; текущий zoom виден в UI.

---

## 10. Scripts (`scripts/`)

### Импорт данных

- Кабели: `sync-submarine-cables.mjs` (Open Undersea Cable Map), `sync-underground-cables.mjs` (data.gov.au Gold Coast, CC-BY 3.0 AU), `sync-underground-copper-cables-osm.mjs` (Overpass, ODbL), `sync-osm-terrestrial-fibre.mjs` (Overpass `man_made=cable`+`telecom:medium=fibre`, ODbL; opt-in через `SEED_IMPORT_OSM_TERRESTRIAL_FIBRE=1`), `sync-afterfibre.mjs` (AfTerFibre terrestrial fibre для Африки, CC-BY 4.0; opt-in через `SEED_IMPORT_AFTERFIBRE=1`).
- Узлы/инфраструктура: `sync-base-stations-osm.mjs`, `sync-major-datacenters.mjs`, `sync-derived-nodes-from-cables.mjs`.
- Спутники: `sync-satellites-tle-celestrak.mjs`, `sync-satellites.mjs`.
- Новости: `sync-news.mjs`, `sync-news-db.ts`.
- Maintenance: `purge-representative-backbone.mjs` — одноразовая очистка устаревшего синтетического слоя backbone-маршрутов (см. [DEVELOPMENT_JOURNAL.md](../DEVELOPMENT_JOURNAL.md)).

#### Источники данных и лицензии (terrestrial/underground fibre)

| Dataset (`metadata.dataset`) | `sourceClass` | Источник | Лицензия |
|---|---|---|---|
| `open_undersea_cable_map` | `official` | [Open Undersea Cable Map](https://github.com/stevesong/open_undersea_cable_map) | CC-BY-SA 4.0 |
| `gold_coast_fibre_optic_cable` | `official` | [data.gov.au — Fibre Optic Cable](https://data.gov.au/data/dataset/fibre-optic-cable) | CC-BY 3.0 AU |
| `openstreetmap` (copper) | `osm_verified` | [OSM Overpass](https://www.openstreetmap.org/) | ODbL 1.0 |
| `osm_terrestrial_fibre` | `osm_verified` | [OSM Overpass](https://www.openstreetmap.org/) (`man_made=cable` + `telecom:medium=fibre`) | ODbL 1.0 |
| `afterfibre` | `official` | [AfTerFibre](https://afterfibre.nsrc.org/) | CC-BY 4.0 |

Синтетический слой `representative_backbone` удалён из проекта (см. `DEVELOPMENT_JOURNAL.md`). Если в БД встречаются записи с таким `metadata.dataset` — использовать `purge-representative-backbone.mjs`.

#### Global terrestrial import (без synthetic)

- OSM terrestrial fibre:
  - `SEED_IMPORT_OSM_TERRESTRIAL_FIBRE=1`
  - `SEED_OSM_TERRESTRIAL_FIBRE_REGIONS=EU,RU,NA,LATAM,APAC,AFRICA,OCEANIA`
  - `SEED_OSM_TERRESTRIAL_FIBRE_LIMIT=120` (лимит `way` на каждый чанк bbox)
- AfTerFibre:
  - `SEED_IMPORT_AFTERFIBRE=1`
  - `SEED_AFTERFIBRE_FILE=<path-to-geojson>` **или** `SEED_AFTERFIBRE_URL=<geojson-url>`

Пример запуска сидов с global-terrestrial:

```bash
SEED_SCOPE=GLOBAL \
SEED_IMPORT_OSM_TERRESTRIAL_FIBRE=1 \
SEED_OSM_TERRESTRIAL_FIBRE_REGIONS=EU,RU,NA,LATAM,APAC,AFRICA,OCEANIA \
SEED_OSM_TERRESTRIAL_FIBRE_LIMIT=120 \
SEED_IMPORT_AFTERFIBRE=1 \
SEED_AFTERFIBRE_URL="https://raw.githubusercontent.com/stevesong/afterfibre-kml/master/Cameroon/Camtel.geojson" \
npm run db:seed
```

Безопасные лимиты для Overpass:

- Рекомендуемый диапазон: `SEED_OSM_TERRESTRIAL_FIBRE_LIMIT=60..150` (выше — больше риск 429/504).
- Для полного мира запускать последовательно (один процесс), не параллелить несколько импортов OSM.
- При частых 429/504 использовать альтернативный endpoint через `OVERPASS_URL`.

#### Main underground mode and scoring

- API режим: `GET /api/network?...&mainUndergroundOnly=1` (также поддерживаются `true|yes|on`).
- UI режим: toggle `only main underground` в панели «Данные» на `/global-network`.
- Поведение:
  - при `mainUndergroundOnly=1` сервер оставляет только underground-элементы с `metadata.isMainUnderground === true`;
  - остальные типы элементов (`SATELLITE`, `SERVER`, submarine и т.д.) остаются в ответе без изменений;
  - обычный режим (`mainUndergroundOnly=0`) работает как раньше.
- Скрипты импорта теперь динамически считают `metadata.rank` и `metadata.isMainUnderground`:
  - `sync-osm-terrestrial-fibre.mjs`: теги `name/ref/operator/network/usage/location/communication/cable/telecom:medium` + длина `path`;
  - `sync-afterfibre.mjs`: `operator/country/status` + длина `path`;
  - `sync-underground-cables.mjs`: атрибуты фичи (`Folder/open/visibility`), число сегментов и длина `path`.
- Как пересчитать магистральность после обновления правил:
  1) запустить соответствующие `sync-*` скрипты повторно (upsert по `sourceId` обновит metadata);
  2) прогнать `scripts/smoke-network-data-extent.mjs` и проверить worldish + `mainUndergroundOnly=1`;
  3) визуально проверить `/global-network`, что toggle уменьшает число underground-линий и оставляет более крупные трассы.

### Smoke / test

- `test-proposals.mjs` (Stage 5), `test-proposals-submit-onchain.mjs` (Stage 6), `test-proposals-stage7.mjs`, `test-proposals-stage8.mjs`.
- `api-auth-verify-auto-username-smoke.mjs`, `api-profile-smoke.mjs`, `manual-cabinet-check.mjs`.
- `test-ux-globe-smoke.mjs`, `smoke-v2-site-routes-api.mjs`, `test-globe-orient-roundtrip.mjs`.
- Внутренние/диагностические: `compute-underground-fiber-bbox.mjs`, `inspect-underground-cables.mjs`, `check-network-element-types.mjs`, `enum-network-element-inspect.mjs`, `seed-belarus-proposal.mjs`, `smoke-network-data-extent.mjs`.

### Ops

- `rollback-drill.mjs` — health + чеклист отката (`npm run ops:rollback-drill`).
- `clean-next.mjs` — Windows workaround для `.next` cache (`npm run dev:clean`).

### Основные npm-скрипты (`package.json`)

- `dev`, `dev:clean`, `dev:turbo`, `build`, `start`, `lint`, `format`, `format:write`.
- Prisma: `prisma:generate`, `prisma:deploy`, `prisma:sync`, `prisma:migrate`, `db:reset`, `db:seed`.
- Тестовые: `test:proposals`, `test:proposals-submit`, `test:proposals-stage7`, `test:proposals-stage8`, `test:auth-profile-smoke`, `test:ux-globe-smoke`, `test:globe-orient`.
- Sync: `scripts:sync-cables`, `scripts:sync-satellites`, `scripts:sync-news`, `scripts:sync-news-db`.

---

## 11. Stage 0–12 (прогресс)

Из `PROJECT_STAGES.md` — **все стадии отмечены `done`**:

| Stage | Содержание |
|-------|------------|
| 0 | scaffolding (Next.js/TS/ESLint/Prisma) |
| 1 | Phantom auth (`tweetnacl+bs58`, upsert User) |
| 2 | 3D-глобус |
| 3 | borders/labels (baseline) |
| 4 | модель сети + импорт |
| 5 | Propose без chain (`Proposal / ChangeAction`) |
| 6 | chain submission (dev mock / Memo tx + Anchor scaffold) |
| 7 | apply / history / rollback |
| 8 | polish |
| 9 | deployment + observability + ops runbooks (`ops:rollback-drill`) |
| 10 | security headers, correlation id, rate limits, threat model |
| 11 | post-launch (scaling архитектура, Redis-ready) |
| 12 | реализация Stage 11 + governance/moderation baseline (`ModerationDecision`, `/moderate`) |

### Инварианты, которые нельзя ломать (must not break)

- Структура App Router (`src/app/*`) и имена страниц (`/propose`, `/predlozhit`, `/global-network`, `/cables`).
- Контракты:
  - `GET /api/network?scope=...&bbox=...`
  - `POST /api/auth/verify` и `POST /api/auth`
  - `GET /api/tile?z=&x=&y=&source=...`
  - `GET /api/geocode/search?q=...`, `GET /api/geocode/reverse?lat=&lng=...`
  - `GET /api/profile?pubkey=`, `POST /api/profile/username`
- Phantom auth flow (подпись + `tweetnacl` + `bs58` + upsert User по pubkey).
- Wallet autoconnect policy (30 мин idle reset, disconnect сбрасывает предпочтение).
- Безопасный lifecycle Leaflet + логика 3D↔2D transition без авто-zoom-переходов.

---

## 12. CI / Operations

- **CI**: `.github/workflows/ci.yml` — `npm ci`, `npm run lint`, `npm run build`, информационный `npm audit` с `continue-on-error`, Node 22.
- **Manual smoke**: `.github/workflows/smoke-tests.yml` — `workflow_dispatch`, поднимает Postgres service и прогоняет Stage 5/6/7/8 smokes.
- Локально перед push:
  ```bash
  npm ci
  npm run lint
  npm run build
  ```
- Smoke при поднятом `npm run dev`:
  ```bash
  npm run test:proposals
  npm run test:proposals-submit
  npm run test:proposals-stage7
  npm run test:proposals-stage8
  npm run test:auth-profile-smoke
  npm run test:ux-globe-smoke
  ```
- Rollback drill: `npm run ops:rollback-drill`.
- Health: `GET /api/health`; structured `api_metric` логи.
- Runbooks и SLO-lite: `docs/operations.md`; секреты — `docs/secrets-policy.md`; релиз — `docs/release-hardening.md`.
- Локальная БД в Docker: `docs/local-dev-docker.md`; Windows quirks (Watchpack, ENOENT pack.gz) — `docs/windows-dev.md` + `npm run dev:clean`.

---

## 13. Документация (карта `docs/`)

Основные файлы (все в `docs/` если не указано иначе):

- **Общие**: `architecture.md`, `requirements.md`, `etapy.md`, `design.md`.
- **Визуализация / данные**: `earth-visualization.md`, `network-data-and-sources.md`, `network-data-sources.md`, `network-repository-overview.md`, `global-network-building-spec.md`, `er-diagram-global-network-db.png`.
- **Стадии**: `stage5plus.md`, `stage6.md`, `stage7.md`, `stage10-security-observability.md`, `stage11-post-launch-architecture.md`, `stage12-scope.md`, `stage12-governance-moderation-architecture.md`, `stage13-admin-panel.md`.
- **Промпты агентов**: `agents/stage6-prompts.md`, `agents/stage7-prompts.md`, ... `agents/stage12-prompts.md`, `agents/ux-globe-phase-prompts.md`, `agents/auth-profile-phase-prompts.md`, `agents/wallet-autoconnect-prompt.md`.
- **UX-сценарии**: `UX_User_Requests_2026-03-20.md`, `UX_User_Requests_2026-03-20_v2_site2d3d_satellite.md`.
- **Ops**: `operations.md`, `db-operations-runbook.md`, `release-hardening.md`, `secrets-policy.md`, `security-observability.md`, `windows-dev.md`, `local-dev-docker.md`.
- **Координация**: `COORDINATOR_DEV_PLAN.md`, `ARCHITECT_CHAT_PLAN.md`, `ISSUES_FIXED.md`.

Корневые:

- `AGENTS.md` — реестр агентов и правил.
- `PROJECT_STAGES.md` — этапы и инварианты.
- `README.md` — быстрый старт.
- `DEVELOPMENT_JOURNAL.md` (~150 KB) — хронологический журнал принятых решений и «граблей». **Любые грабли/инциденты фиксировать сюда.**

---

## 14. Переменные окружения

Шаблон — `.env.example` (актуальное значение — там). Ключевые:

- `DATABASE_URL` — PostgreSQL connection string.
- `NEXT_PUBLIC_SOLANA_RPC` — RPC endpoint (по умолчанию devnet).
- `MODERATOR_PUBKEYS` — **deprecated**; comma-separated base58 pubkeys для fallback `/api/moderation/*` и входа кошельком как `MODERATOR`. Предпочтительно `ModeratorGrant` + `npm run migrate:moderator-env`.
- `ADMIN_WALLET_PUBKEY` — base58 pubkey админ-кошелька для входа через Phantom.
- `STAFF_SESSION_SECRET` — секрет для подписи nonce (`/api/admin/auth/nonce`), длина не меньше 16 символов.
- `ADMIN_SMOKE_WALLET_SECRET` (только dev/CI) — base58 секретного ключа, совпадающего с `ADMIN_WALLET_PUBKEY`, для `npm run test:admin-smoke`.
- `RATE_LIMIT_BACKEND` (`redis` | default in-memory), `REDIS_URL`.
- `NODE_ENV` — в `dev/test` submit возвращает `dev-tx-...`, в `production` — реальную Memo-tx.
- Опционально для smoke: `SKIP_GEOCODE_SMOKE=1`.

Политика секретов — `docs/secrets-policy.md`. `.env*` файлы **не коммитить**, не логировать.

---

## 15. Правила работы для новых агентов

1. **До любых изменений** — прочитать этот файл + `AGENTS.md` + `PROJECT_STAGES.md`.
2. Если задача связана со стадией — открыть `docs/agents/<stage>-prompts.md` и выполнять **только** свою секцию (A–G по роли).
3. Не менять API-контракты из §7 и инварианты из §11 без явной задачи от координатора.
4. БД меняет только **DBPrismaAgent**; API-агент синхронизируется после миграции.
5. Любую новую «граблю» / не-очевидное решение — фиксировать в `DEVELOPMENT_JOURNAL.md` (создавать запись с датой).
6. Для UI-изменений сверяться с UX-инвариантами (SiteHeader, 3D↔2D transition, wallet autoconnect, username permissions).
7. После правок запускать `npm run lint` и, при релевантных изменениях, соответствующие smoke-скрипты (см. §10, §12).
8. Секреты (ключи, сиды, пароли) не вставлять в код, логи или `DEVELOPMENT_JOURNAL.md`.

---

## 16. TL;DR для спешащих

- **Что**: Next.js 15 + TS + PostgreSQL/Prisma + Three.js/Leaflet + Solana/Phantom.
- **О чём диплом**: устойчивость транзакций при частичном отсутствии интернета (mesh/SMS/VSAT/offline-queue — отражено и в `NetworkElementType`, и в UI).
- **Фичи**: 3D/2D визуализация мировой телеком-инфраструктуры, Phantom-auth, governance (Proposal/Vote/Moderation/Apply/Rollback), on-chain submission (Memo-tx в prod, mock в dev).
- **Состояние**: Stage 0–12 закрыты, идёт полировка UX/Globe + Propose + on-chain (см. git status и `DEVELOPMENT_JOURNAL.md`).
- **Не ломать**: API-контракты из §7, UX-инварианты из §9, autoconnect policy, Phantom-auth flow, структуру App Router.
