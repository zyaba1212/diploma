# Stage 12: Governance & Moderation Baseline Architecture

## Scope / invariants
- Не менять публичные контракты Stage 5–8 в `/api/proposals/*`.
- Moderation добавляется в отдельный контур под `/api/moderation/*`.

## 1) Moderation workflow

Базовый поток модерации предложений:
- `SUBMITTED` -> `ACCEPTED`
- `SUBMITTED` -> `REJECTED`

Ключевые правила:
- Первое решение возможно только когда `Proposal.status === 'SUBMITTED'`.
- Идемпотентность: повторный вызов для уже принятого статуса возвращает success и не меняет решение.
- Защита от двойного решения реализуется через атомарность/условное обновление `updateMany` по `status: 'SUBMITTED'` и последующую проверку текущего статуса при гонках.

## 2) Persistent audit trail

Для аудита решений используется `ModerationDecision`:
- `ModerationDecision.proposalId` — `@unique`
- `moderatorPubkey`
- `fromStatus`
- `toStatus`
- `decidedAt`
- `decisionSignature` — опционально (base58)

Side effects при новом решении:
- `Proposal.status` обновляется до `ACCEPTED|REJECTED`
- `Proposal.decidedAt` устанавливается на момент решения

## 3) Moderator allowlist

Identity модератора в v1 ограничивается allowlist’ом:
- env `MODERATOR_PUBKEYS` — список base58 pubkey, разделенный запятыми
- endpoint требует `moderatorPubkey` в request body
- если `moderatorPubkey` не входит в allowlist -> `403 { error: 'forbidden' }`

## 4) Phantom signature verification (optional)

Подпись проверяется только если поле `signature` передано в request body.

Если `signature` есть:
- signature — base58 Ed25519 signature
- `moderatorPubkey` — base58 public key
- проверка выполняется tweetnacl: `nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes)`

Подписываемое сообщение (must match implementation):
- `diploma-z96a moderation:decide:<proposalId>:<toStatus>`
- где `<toStatus>` строго нормализуется к `ACCEPTED|REJECTED`

Ошибки signature-валидации:
- неверный base58 формат `signature/pubkey` -> `400 { error: 'invalid base58 signature/pubkey' }`
- неверная подпись -> `400 { error: 'signature invalid' }`

Если `signature` не передан:
- позволение всё равно даёт allowlist `MODERATOR_PUBKEYS`
- audit record создается/обновляется без `decisionSignature`

## 5) Endpoint contract

### Decide endpoint
- `POST /api/moderation/proposals/:id/decide`

### Request body
- `moderatorPubkey` (string, required)
- `decision` (string, required)
  - принимает `ACCEPT|ACCEPTED` или `REJECT|REJECTED`
  - нормализуется в `toStatus` (`ACCEPTED|REJECTED`)
- `signature` (string, optional base58)

### Rate limiting (shared state)
- проверка выполняется через общий util `src/lib/rateLimit.ts`
- key: `moderation.decide:<clientIp>`
- лимит: `10 req / 60s / IP`

Для multi-instance корректности в production:
- включить Redis-backed режим: `RATE_LIMIT_BACKEND=redis` + `REDIS_URL`
- если Redis недоступен/сломался — backend деградирует в in-memory режим, но формат ответа `429 { error: 'rate limit exceeded' }` остается прежним.

### Success responses (`200`)
- Если предложение уже в целевом статусе:
  - `{ ok: true, status: "ACCEPTED" | "REJECTED" }`
  - backend делает upsert `ModerationDecision` (audit record гарантирован)
- Если это новое решение (переход из `SUBMITTED`):
  - `{ ok: true, status: "ACCEPTED" | "REJECTED", moderationDecisionId: string }`

### Error responses (типовые)
- `400` — invalid json / missing required fields / invalid decision
- `403` — moderator не из allowlist
- `404` — proposal не найден
- `409` —
  - proposal не в `SUBMITTED`
  - конфликт двойного решения (race)
- `429` — rate limit exceeded (`{ error: 'rate limit exceeded' }`)
- `500` — `internalApiError('moderation failed', 500)` с `{ error: 'moderation failed', correlationId }`

## 6) Idempotency & double-decision protection

Идемпотентность:
- если `proposal.status === toStatus`:
  - upsert `ModerationDecision` и возврат `200 ok` без смены `Proposal.status`

Гонки/двойное решение:
- при новом решении backend делает `updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: toStatus, decidedAt: now } })`
- если `updatedCount.count !== 1`:
  - backend читает текущий `Proposal.status`
  - если он уже равен `toStatus` -> возвращает success
  - иначе -> `409 { error: 'proposal already decided' }`

## 7) Observability hooks

На каждый вызов backend пишет structured API метрики через `logApiMetric`:
- `route: '/api/moderation/proposals/:id/decide'`
- `method: 'POST'`
- `status`, `durationMs`, `ok: true`
- `note: 'already_decided' | 'decided'`

Следовательно, алертинг по:
- rate/ошибкам (`4xx/5xx`)
- latency/p95
- всплескам `429`

должен учитывать `/api/moderation/*` так же, как и `/api/proposals/*`.

# Stage 12 — Governance / Moderation baseline (moderation contract)

Цель: дать минимально достаточный **управляемый поток решений** по предложениям, чтобы в проде контролировать переход `SUBMITTED -> ACCEPTED|REJECTED` без изменения публичных контрактов Stage 5–8.

Новые маршруты (не ломают существующие): только под префиксом `/api/moderation/*`.

## 1) Роли и allowlist

- **Author**: автор предложения (хранится в `Proposal.authorPubkey`).
- **Moderator**: оператор/модератор, разрешённый конфигом.

Разрешённые модераторы задаются env-переменной:

- `MODERATOR_PUBKEYS` — список base58 pubkey, разделённый запятыми (или whitespace); используется как allowlist.

## 2) Workflow (статусные переходы)

- Допустимое состояние для решения: `Proposal.status === SUBMITTED`.
- Решение модератора переводит:
  - `SUBMITTED -> ACCEPTED` (accept),
  - `SUBMITTED -> REJECTED` (reject).

Идемпотентность:
- для одного `proposalId` может существовать **только одно** решение модерации (уникальность `ModerationDecision.proposalId` в Prisma).
- повторный вызов с тем же `toStatus` возвращает тот же `ModerationDecision.id`.
- повторный вызов с другим `toStatus` возвращает конфликт (например, `409`) и **не меняет** уже принятое решение.

Protection от двойного применения:
- двойное решение запрещается уникальным ограничением на таблице `ModerationDecision`,
- и/или серверной проверкой: если решение уже существует — изменения не выполняются.

## 3) Аудит trail (хранение решения)

Источник истины для аудита:

- `ModerationDecision`:
  - `proposalId` (unique),
  - `moderatorPubkey`,
  - `fromStatus`,
  - `toStatus`,
  - `decidedAt`,
  - `decisionSignature?` (опционально, если команда решит хранить proof-артефакт).

Side effects:
- `Proposal.status` обновляется до `ACCEPTED` / `REJECTED`,
- `Proposal.decidedAt` обновляется/устанавливается.

## 4) Авторизация модератора (stateless signature)

Так как в проекте нет server-side session в auth flow (Phantom signature проверяется на запросе), moderation endpoints должны быть stateless.

Минимально достаточная гарантия — allowlist модераторов:

- `moderatorPubkey` должен входить в env `MODERATOR_PUBKEYS`.

Опционально (усиление proof):

- клиент может передать `signature` (base58 ed25519),
- подпись проверяется только если `signature` передан,
- message для проверки вычисляется на стороне backend:
  - `diploma-z96a moderation:decide:<proposalId>:<toStatus>`
  - `<toStatus>` — нормализованный итог решения: `ACCEPTED` или `REJECTED`.

## 5) API Contract (минимальный контракт moderation)

### 5.1 Decide endpoint (единый маршрут)

- `POST /api/moderation/proposals/:id/decide`

Request body:

```ts
type ModerationDecisionRequest = {
  moderatorPubkey: string; // base58, required (allowlist check)
  decision: 'ACCEPT' | 'REJECT' | 'ACCEPTED' | 'REJECTED'; // required
  signature?: string; // optional base58 signature over backend-computed message
};
```

Success response (минимально):

```json
{
  "ok": true,
  "status": "ACCEPTED|REJECTED",
  "moderationDecisionId": "string" // присутствует только при первом решении
}
```

Error handling (единая форма как в остальном API):

- `400` — invalid json / missing fields,
- `400` — invalid base58 signature/pubkey / signature invalid,
- `403` — moderatorPubkey not in allowlist,
- `409` — proposal not in `SUBMITTED` or decision already exists (double decision / race),
- `429` — rate limit exceeded (`{ error: "rate limit exceeded" }`),
- `5xx` — internal error (`{ error: "internal error" }`).

### 5.2 Idempotency semantics

- Если `Proposal.status` уже равен запрошенному итоговому `status`:
  - возвращаем `200 { ok: true, status }` (backend также обеспечивает audit upsert),
- Если запрошенное решение невозможно (не `SUBMITTED` / другая грань решения):
  - возвращаем `409` и не меняем существующую запись.

## 6) Связь с остальными Stage 5–8 контрактами

- `POST /api/proposals/:id/apply` в production должен позволять применение только если `Proposal.status === ACCEPTED` (в dev есть послабления).
- Поэтому moderation decision — ключевой gate перед apply/history/rollback pipeline.

# Stage 12: Governance & Moderation Baseline Architecture

## Scope / invariants
- Не менять публичные контракты Stage 5–8 в `/api/proposals/*`.
- Moderation реализуется в отдельном контуре под `/api/moderation/*`.

## 1) Moderation state machine

Базовый целевой поток решения для “живых” предложений:
- `SUBMITTED` -> `ACCEPTED`
- `SUBMITTED` -> `REJECTED`

Критичные правила:
- Первое решение всегда должно начинаться из `Proposal.status === 'SUBMITTED'`.
- Повторные решения идемпотентны только в пределах “решение в тот же статус”.
- Любая попытка принять решение, когда текущее состояние отличается от `SUBMITTED`, считается конфликтом.

## 2) Persistent audit trail

Для аудита и идемпотентности используется отдельная сущность:
- `ModerationDecision.proposalId` — `@unique`
- `ModerationDecision.moderatorPubkey` — кто вынес решение
- `ModerationDecision.fromStatus` / `toStatus`
- `ModerationDecision.decidedAt` — timestamp решения
- `ModerationDecision.decisionSignature` — опционально (base58)

Параллельно backend обновляет:
- `Proposal.status` в конечный статус (`ACCEPTED|REJECTED`)
- `Proposal.decidedAt` на момент решения

## 3) Moderator identity & allowlist

Идентичность модератора в v1 ограничивается allowlist’ом:
- env `MODERATOR_PUBKEYS` — comma-separated список base58 pubkey
- эндпоинт требует `moderatorPubkey` в request body
- если `moderatorPubkey` не входит в `MODERATOR_PUBKEYS` -> `403 { error: 'forbidden' }`

## 4) Signature verification (optional)

Signature проверяется только если присутствует `signature` в request body.

Если `signature` передан, backend проверяет Ed25519 signature (base58):
- message (канонический):
  - `diploma-z96a moderation:decide:<proposalId>:<toStatus>`
- `toStatus` — нормализуется к `ACCEPTED|REJECTED` (из `ACCEPT|ACCEPTED` и `REJECT|REJECTED`)
- неверный base58 формат -> `400 { error: 'invalid base58 signature/pubkey' }`
- неверная подпись -> `400 { error: 'signature invalid' }`

Если signature не передан:
- identity всё равно валидируется через allowlist `MODERATOR_PUBKEYS`
- audit record создается/обновляется без `decisionSignature`

## 5) Moderation endpoint contract

### Endpoint
- `POST /api/moderation/proposals/:id/decide`

### Request body
- `moderatorPubkey` (string, required)
- `decision` (string, required)
  - допустимо: `ACCEPT|ACCEPTED` или `REJECT|REJECTED`
- `signature` (string, optional base58)

### Rate limiting (shared state)
- проверка rate limit выполняется через общий util `src/lib/rateLimit.ts`
- ключ: `moderation.decide:<clientIp>`
- лимит: `10 req / 60s / IP`

Для multi-instance корректности в production требуется Redis-backed режим:
- `RATE_LIMIT_BACKEND=redis` + `REDIS_URL`
- при проблемах с Redis backend деградирует в in-memory режим, но формат ответов и коды остаются прежними (`429 { error: 'rate limit exceeded' }`).

### Responses
Успех (`200`):
- если предложение уже в целевом статусе:
  - `{ ok: true, status: "ACCEPTED" | "REJECTED" }`
  - backend делает upsert `ModerationDecision` (audit record гарантирован)
- если впервые переводится из `SUBMITTED`:
  - `{ ok: true, status: "ACCEPTED" | "REJECTED", moderationDecisionId: string }`

Типовые ошибки:
- `400` — неверный JSON / отсутствуют поля / неверный `decision`
- `403` — `moderatorPubkey` не в allowlist
- `404` — proposal не найден
- `409`:
  - proposal не в `SUBMITTED`
  - конфликт двойного решения (race)
- `429` — rate limit exceeded
- `500` — неожиданные ошибки (например, fallback/БД)

## 6) Idempotency & double-decision protection

Реализация идемпотентности и защиты от двойного решения:
- если `Proposal.status === toStatus`:
  - upsert `ModerationDecision` и возврат `200 ok` без изменения статуса
- если `Proposal.status !== 'SUBMITTED'`:
  - `409 { error: 'proposal is not SUBMITTED' }`
- если `updateMany({ where: { id, status: 'SUBMITTED' } })` не обновил ровно 1 запись:
  - это рассматривается как гонка/двойное решение
  - backend повторно читает текущий `Proposal.status`
    - если совпадает с `toStatus` -> `200`
    - иначе -> `409 { error: 'proposal already decided' }`

## 7) Observability / alerting hooks

На moderation endpoint backend пишет structured API метрики через `logApiMetric`:
- `route: '/api/moderation/proposals/:id/decide'`
- `method: 'POST'`
- `status`, `durationMs`, `ok: true`
- `note: 'already_decided' | 'decided'`

Следовательно, алертинг по:
- 4xx/5xx rate,
- p95/latency,
- всплескам `429`,

должен учитывать `/api/moderation/*` так же, как и `/api/proposals/*`.

