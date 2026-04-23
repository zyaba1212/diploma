# Stage 13 — полноценная админ-панель

## Цели

- Единый staff-логин с ролями **`ADMIN`** и **`MODERATOR`** (`StaffSession.role`, опционально `pubkey` для входа через Phantom).
- Многовкладочный UI под `/admin/(dashboard)/*` с матрицей доступа по ролям.
- Аудит действий в **`AuditLog`**, расширение модели **`User`** (бан), **`Proposal`** (принудительная отмена, `rejectionReason`), **`ModerationDecision.comment`**.
- Staff-модерация без Phantom-подписи: `POST /api/admin/moderation/:id/decide` (ядро `handleModerationDecision` с флагами `trustedFromStaff` / `skipModeratorAllowlistCheck`).
- Миграция env: `npm run migrate:moderator-env` — перенос `MODERATOR_PUBKEYS` → `User` + `ModeratorGrant` (см. `scripts/migrate-moderator-env.mjs`). Переменная **`MODERATOR_PUBKEYS` deprecated**, но остаётся для совместимости с `POST /api/moderation/*`.

## Миграция БД

Имя каталога: `20260425120000_stage13_admin_panel_baseline`.

## Матрица вкладок UI

Одинаковый доступ у **ADMIN** и **MODERATOR**, кроме вкладки **«Модераторы»** (назначение `ModeratorGrant`) — только **ADMIN**.

| Вкладка | ADMIN | MODERATOR |
|---------|:-----:|:---------:|
| Обзор | ✓ | ✓ |
| Пользователи | ✓ | ✓ |
| Модераторы | ✓ | — |
| Предложения | ✓ | ✓ |
| Очередь модерации | ✓ | ✓ |
| Журнал решений | ✓ | ✓ |
| Сессии | ✓ | ✓ |
| Аудит | ✓ | ✓ |
| Новости (RSS cache) | ✓ | ✓ |

## API (`/api/admin/*`)

### Auth / сессия

| Метод | Путь | Доступ | Описание |
|-------|------|--------|----------|
| GET | `/api/admin/auth/nonce` | публично | Подписанный nonce (+ rate-limit). |
| POST | `/api/admin/login/wallet` | публично | `ADMIN_WALLET_PUBKEY` → `ADMIN`; иначе `ModeratorGrant` / `MODERATOR_PUBKEYS` → `MODERATOR`. |
| POST | `/api/admin/logout` | staff | |
| GET | `/api/admin/me` | staff | `{ ok, role, pubkey }`. |

### Пользователи и модераторы

| Метод | Путь | Доступ |
|-------|------|--------|
| GET | `/api/admin/users` | staff |
| POST | `/api/admin/users/:pubkey/ban` | staff |
| DELETE | `/api/admin/users/:pubkey/ban` | staff |
| GET | `/api/admin/moderators` | ADMIN |
| POST | `/api/admin/moderators` | ADMIN |
| DELETE | `/api/admin/moderators/:pubkey` | ADMIN |

Ответ `GET /api/admin/moderators` дополнительно содержит `envModeratorPubkeysDeprecated` — ключи из `MODERATOR_PUBKEYS` (read-only).

### Предложения (админ-скоуп)

| Метод | Путь | Доступ |
|-------|------|--------|
| GET | `/api/admin/proposals` | staff (`requireStaff`) |
| GET | `/api/admin/proposals/:id` | staff |
| PATCH | `/api/admin/proposals/:id` | staff (`pinned`, `cancelReason` → `CANCELLED`) |
| DELETE | `/api/admin/proposals/:id` | staff (жёсткое удаление; см. комментарии в коде) |
| POST | `/api/admin/proposals/:id/force-rollback` | staff |

### Модерация (staff)

| Метод | Путь | Доступ |
|-------|------|--------|
| POST | `/api/admin/moderation/:id/decide` | `requireModerator` (тело: `toStatus` / `decision`, `comment`, `rejectionReason`) |
| GET | `/api/admin/moderation-decisions` | `requireModerator` |

### Сессии, аудит, статистика, новости

| Метод | Путь | Доступ |
|-------|------|--------|
| GET | `/api/admin/sessions` | staff |
| DELETE | `/api/admin/sessions/:id` | staff |
| POST | `/api/admin/sessions/revoke-all` | staff |
| GET | `/api/admin/audit-log` | staff |
| GET | `/api/admin/stats` | staff (в т.ч. `recentAudit` для всех staff-ролей) |
| GET | `/api/admin/news` | ADMIN |
| POST | `/api/admin/news/sync` | ADMIN |
| DELETE | `/api/admin/news/:id` | ADMIN |

## Навигация

- **`/moderate`** → редирект на **`/admin/moderation`**.
- В **`SiteHeader`** пункт «Админка» показывается, если `GET /api/admin/me` возвращает 200.

## Вспомогательные модули

- `src/lib/admin-guard.ts` — `requireStaff` / `requireAdmin` / `requireModerator`.
- `src/lib/audit.ts` — `recordAuditEvent`, константы `AuditAction`.
- `src/lib/adminFetch.ts` — общие fetch-хелперы для клиентских страниц админки.
- `src/lib/news.ts` — общая логика RSS → `NewsCache` (используется и публичным `GET /api/news`, и `POST /api/admin/news/sync`).

## Smoke

`npm run test:admin-smoke` — вход админа через кошелёк: нужны `STAFF_SESSION_SECRET`, `ADMIN_WALLET_PUBKEY`, `ADMIN_SMOKE_WALLET_SECRET` (base58 ключа, pubkey совпадает с `ADMIN_WALLET_PUBKEY`); далее пользователи, решения, статистика, pin/unpin, ban/unban, сценарий модератора по кошельку (если тестовый pubkey ≠ `ADMIN_WALLET_PUBKEY`).
