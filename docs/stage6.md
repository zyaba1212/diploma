# Stage 6: Chain + Anchor (on-chain submission)

## Цель Stage 6

Для предложения `Proposal` в статусе `SUBMITTED` выполнить on-chain фиксацию (Anchor/solana транзакция), привязав on-chain запись к **каноническому** `contentHash` предложения.

При этом существующие маршруты Stage 5 (например, `/api/network`, `/api/auth/*`, `/api/tile`, `/api/geocode/*` и логика Propose-edit) не изменяются.

## Используемые поля `Proposal`

Для расчёта/проверки и “submission” в Stage 6 используются следующие поля:

- `Proposal.id` — идентификатор предложения (из URL эндпоинта).
- `Proposal.status` — ожидаемое значение для on-chain submission: `SUBMITTED`.
- `Proposal.authorPubkey: string` — публичный ключ автора для проверки подписи.
- `Proposal.scope`, `Proposal.title?`, `Proposal.description?` — текущие поля предложения, из которых backend повторно вычисляет `contentHash` для Stage 5 minimum (при этом `actions = []`).
- `Proposal.submittedAt?: Date`
  - используется как “временная опора” для бизнес-логики (например, чтобы запретить on-chain submission до `SUBMITTED`).

На этом шаге Stage 6 endpoint **сохраняет** в БД:
- вычисленный `contentHash`,
- `signature` (base58),
- `onChainTxSignature` и `onChainSubmittedAt`.

## Stable hash и подпись автора

### Канонизация (stable stringify)

`stableJson(x)` — детерминированная сериализация для Stage 6 v1:

1. Для объектов: рекурсивно сортировать ключи **лексикографически** по строковому представлению ключа (на каждом уровне отдельно).
2. Для массивов: сохранять исходный порядок элементов (индексы влияют на хэш).
3. Примитивы сериализуются как в обычном JSON (RFC8259):
   - строки -> JSON string (двойные кавычки + JSON escaping),
   - `null` -> `null`,
   - числа/булевы -> как в обычном JSON.
4. В каноническом объекте для v1 не используется `undefined`:
   - `title` и `description` включаются только если соответствующие поля в `Proposal` не равны `null` (если `null`, ключи отсутствуют);
   - `undefined` в canonicalInput не используется.
5. Итоговая строка без произвольных пробелов/переносов (строка = результат deterministic serializer).

### contentHash (точный формат для подписи Stage 6)

Канонический объект для хэширования в Stage 6 v1 (Stage 5 minimum, `actions = []`):

```json
{
  "proposalFields": {
    "scope": "GLOBAL" | "LOCAL"
  },
  "actions": []
}
```

Примечание: `title` и `description` в канонический объект включаются только если соответствующие поля не равны `null` (иначе ключи отсутствуют).

`contentHash = sha256( UTF8(stableJson(canonicalInput)) )`

- sha256 считается по UTF-8 байтам строки `stableJson(...)`
- digest кодируется в **hex lowercase** (64 символа).

### Message для подписи и формат `signature`

Пользователь подписывает:

- `message = "diploma-z96a propose:" + contentHash`

`signature` передаётся как base58-строка подписи этих UTF-8 байтов.

## On-chain endpoint(ы)

### POST `/api/proposals/:id/submit`

Запрос предназначен для Stage 6 фиксации предложения в Solana: backend проверяет `contentHash` + подпись и возвращает `txSignature`.

Где `:id` — это `Proposal.id`.

#### Request body (что отправляет frontend)

Минимальный набор:

- `signature: string` (base58; подпись message `diploma-z96a propose:<contentHash>`)
- `contentHash?: string` (hex/base16, опционально; будет проверен, если передан)

Поля auth/автор определяются сервером из `Proposal.authorPubkey`, чтобы фронтенд не подменял автора.

#### Ответ (что возвращает backend)

- `txSignature: string`

#### Smoke tests (dev)
В текущем минимальном Stage 6 backend возвращает mock `txSignature` (без Anchor). Проверки выполняются как:

1. Запустить dev-сервер (`npm run dev`).
2. Отдельно выполнить:
   - `npm run test:proposals-submit`

Тесты:
- создают в БД `Proposal` со статусом `SUBMITTED` (через Prisma в тест-скрипте);
- проверяют, что валидная подпись возвращает `txSignature`;
- проверяют, что невалидная подпись возвращает `400`;
- дополнительно: проверяют, что несуществующий `id` возвращает `404`.

#### Devnet / production (реальный txSignature)
Если нужно отправить реальную Solana-транзакцию (Memo placeholder) вместо dev-mock:
1. Запустить сервер в production с env:
   `SOLANA_RPC_URL=<DEVNET_RPC> SOLANA_SUBMISSION_PAYER_PRIVATE_KEY_B58=<PAYER_PRIVATE_KEY_B58> npm run start`
2. В другом терминале выполнить:
   `BASE_URL=http://localhost:3000 npm run test:proposals-submit`

#### Семантика на backend

1. Проверить существование `Proposal` по `:id`.
2. Проверить `Proposal.status === "SUBMITTED"`.
3. Повторно вычислить `computedContentHash` из текущих полей `Proposal` (и списка `actions` из БД):
   - если `Proposal.contentHash` уже задан и не совпадает (case-insensitive) — вернуть `400`;
   - если `body.contentHash` не совпадает (case-insensitive) — вернуть `400`.
4. Проверить подпись:
   - публичный ключ — `Proposal.authorPubkey`
   - message — `diploma-z96a propose:<computedContentHash>`
   - подпись — `body.signature`
5. Если `Proposal.onChainTxSignature` и `Proposal.onChainSubmittedAt` уже заполнены, вернуть существующий `txSignature` (без повторной отправки).
6. Иначе отправить транзакцию:
   - в `NODE_ENV !== "production"` — dev/mock `txSignature` (формат `dev-tx-...`);
   - в `production` — отправить Solana Memo-транзакцию (Memo placeholder) и вернуть реальный `txSignature`.
7. На success сохранить в БД `contentHash`, `signature`, `onChainTxSignature` и `onChainSubmittedAt` и вернуть `{ txSignature }`.

В случае расхождения хэша/подписи — вернуть ошибку валидации и не отправлять транзакцию.

## Минимальный Anchor program (Stage 6 v1)

### Цель on-chain фиксации

Хранить неизменяемую on-chain запись факта submission предложения в статусе `SUBMITTED`, привязанную к каноническому `contentHash`.

На Stage 6 v1 on-chain **не выполняет** криптографическую проверку подписи Phantom. Проверка подписи выполняется backend off-chain, а on-chain только сохраняет хэш/факт submission для последующей верификации.

### Instruction: `submit_proposal`

Минимальная instruction (название может быть `submit_proposal`, логика — та же).

Instruction принимает (аргументы в байтах, которые backend подготовит перед отправкой):

- `proposalIdHash: [u8; 32]`
  - backend считает `proposalIdHash = sha256(UTF8(Proposal.id))`
  - это эквивалент “proposalId (или hash)” и хорошо подходит для PDA seeds фиксированного размера
- `contentHash: [u8; 32]`
  - backend получает/вычисляет `contentHash` по `contentHash` из запроса (или по вычисляемым полям Proposal) и передаёт его в instruction
- `signatureHash: [u8; 32]`
  - backend считает `signatureHash = sha256(signatureBytes)`
  - `signatureBytes` получаем base58 decode из `body.signature`
- `authorPubkey: Pubkey`
  - `Proposal.authorPubkey` в формате Pubkey
- `status: u8`
  - на Stage 6 v1 ожидается `SUBMITTED = 1`

Допустимые on-chain проверки на Stage 6 v1:
- `status` должен соответствовать ожидаемому значению (`SUBMITTED`);
- `author` (signer) должен совпадать с `author_pubkey`;
- `content_hash` используется как часть PDA seeds (через `seeds = [..., &content_hash]`), поэтому “неверный” `contentHash` адресует другой PDA (контракт не пытается пересчитать stable-hash по исходным данным).

### On-chain аккаунт: `ProposalSubmissionV1`

Аккаунт создаётся как PDA и **не перезаписывается** (используется `init`).

#### Версионность (чтобы не “закрасить” будущие изменения)

Версия заложена:

1. В seed (префикс + `DATA_VERSION`).
2. В поле аккаунта `data_version`.

Если появится `submit_proposal` версии v2 (новые поля/размеры), то будет новый seed-префикс и новые PDA, а старые аккаунты сохранятся.

#### PDA seed схема

- `DATA_VERSION: u8 = 1`
- `SUBMISSION_PREFIX = "proposal_submission"`

Seeds:

- `["proposal_submission", DATA_VERSION, proposalIdHash, contentHash]`

Следствия:

- повторная фиксация с теми же `proposalIdHash` + `contentHash` по тем же seeds упадёт (не перезапишет аккаунт);
- фиксация с другим `contentHash` создаст новый PDA (если потребуется повторная submission после корректировок).

#### Поля аккаунта (минимум под требования)

- `data_version: u8`
- `proposal_id_hash: [u8; 32]`
- `content_hash: [u8; 32]`
- `author_pubkey: Pubkey`
- `status: u8`
- `submitted_at_unix: i64`
- `signature_hash: [u8; 32]`

#### Концептуальный Anchor-скелет

Ниже — скелет логики (псевдо-Rust/Anchor) для спецификации:

```rust
const DATA_VERSION: u8 = 1;
const SUBMITTED_STATUS: u8 = 1;

#[derive(Accounts)]
#[instruction(proposal_id_hash: [u8; 32], content_hash: [u8; 32], status: u8)]
pub struct SubmitProposalV1<'info> {
  #[account(
    init,
    payer = payer,
    space = ProposalSubmissionV1::SIZE,
    seeds = [
      b"proposal_submission",
      &[DATA_VERSION],
      &proposal_id_hash,
      &content_hash,
    ],
    bump
  )]
  pub submission: Account<'info, ProposalSubmissionV1>,

  pub author: Signer<'info>,

  #[account(mut)]
  pub payer: Signer<'info>,
  pub system_program: Program<'info, System>,
}

#[account]
pub struct ProposalSubmissionV1 {
  pub data_version: u8,
  pub proposal_id_hash: [u8; 32],
  pub content_hash: [u8; 32],
  pub author_pubkey: Pubkey,
  pub status: u8,
  pub submitted_at_unix: i64,
  pub signature_hash: [u8; 32],
}

pub fn submit_proposal(
  ctx: Context<SubmitProposalV1>,
  proposal_id_hash: [u8; 32],
  content_hash: [u8; 32],
  signature_hash: [u8; 32],
  author_pubkey: Pubkey,
  status: u8,
) -> Result<()> {
  require!(status == SUBMITTED_STATUS, ErrorCode::InvalidStatus);
  require!(ctx.accounts.author.key() == author_pubkey, ErrorCode::InvalidAuthor);
  let clock = Clock::get()?;
  ctx.accounts.submission.set_inner(ProposalSubmissionV1 {
    data_version: DATA_VERSION,
    proposal_id_hash,
    content_hash,
    author_pubkey,
    status,
    submitted_at_unix: clock.unix_timestamp,
    signature_hash,
  });
  Ok(())
}
```

### Где выполняется проверка подписи (Stage 6 v1)

Требование из постановки: “приемлемо off-chain verify на backend + on-chain хранение hash/подписи (если on-chain verify сложно)”.

Распределение:

1. **Backend (обязательная проверка подписи):**
   - проверяет ed25519 подпись Phantom на message:
     - `message = "diploma-z96a propose:" + contentHash`
   - публичный ключ берётся из `Proposal.authorPubkey`
   - при несовпадении — on-chain transaction НЕ отправляется
2. **On-chain (v1):**
   - проверяет допустимость статуса (`status == SUBMITTED`);
   - проверяет, что `author` (signer транзакции) совпадает с `author_pubkey`;
   - не проверяет подпись математически (это остаётся на backend);
   - хранит `signatureHash` (hash подписи) вместе с `content_hash` и `author_pubkey`.

Эта схема минимизирует сложность контракта на Stage 6 v1 и оставляет криптографию на backend.

### Контракт для BackendAPIAgent (точные payload/аккаунты)

On-chain instruction: `submit_proposal` (Anchor program v1).

#### 1) Что backend передаёт в instruction data (exact types)

Backend должен послать следующие аргументы (в указанном порядке в IDL Anchor):

- `proposalIdHash: [u8; 32]`
  - вычисление backend’ом: `sha256(UTF8(Proposal.id))`
  - bytes = 32 байта
- `contentHash: [u8; 32]`
  - вход backend’а: `contentHash` из `Proposal.contentHash` / запроса
  - формат: hex/base16 строка `sha256(...)` длиной 64 hex-символа
  - преобразование: decode hex -> 32 bytes
- `signatureHash: [u8; 32]`
  - вход backend’а: `Proposal.signature` (base58 ed25519 signature) / `body.signature`
  - преобразование:
    - `signatureBytes = bs58_decode(signature)`
    - `signatureHash = sha256(signatureBytes)` => 32 bytes
- `authorPubkey: Pubkey`
  - `Proposal.authorPubkey` (base58) в формат `Pubkey`
- `status: u8`
  - v1 ожидает `SUBMITTED = 1`

#### 2) Какие accounts передаются в instruction context (account list)

Instruction accounts для `submit_proposal`:

1. `submission` (PDA, writable)
   - PDA вычисляется как `findProgramAddress` по seeds:
     - `["proposal_submission", DATA_VERSION=1, proposalIdHash, contentHash]`
   - на v1 создаётся через `init`, повторный вызов с теми же seed’ами должен падать (PDA не перезаписывается)
2. `payer` (Signer, writable)
   - серверный keypair, который платит rent/fees (не автор предложения)
3. `system_program` (readonly)
   - `SystemProgram.programId`

#### 3) Как проверяется авторство на on-chain (v1)

На Stage 6 v1 авторство на chain **не проверяется** криптографически:

- signature проверяется backend’ом off-chain (см. секцию выше);
- на chain пишутся:
  - `author_pubkey` (из `Proposal.authorPubkey`)
  - `signature_hash` (sha256 от base58-decoded signature bytes)

Поэтому “подмена автором” невозможна, если backend следует контракту валидации.

#### 4) Рекомендуемый интерфейс (Backend helper)

BackendAPIAgent должен использовать helper (чтобы исключить расхождения конвертаций и seed-параметров):

- `src/lib/stage6/proposalSubmission.ts`
  - `getProposalSubmissionPda(programId, proposalIdHash, contentHashBytes)`
  - `hexSha256ToBytes(contentHashHex)`
  - `signatureBase58ToSignatureHashBytes(signatureBase58)`
  - `sha256Utf8(Proposal.id)` (для `proposalIdHash`)

Интеграционная точка на backend:

- `src/app/api/proposals/[id]/submit/route.ts`
  - в `production` заменить текущий `Memo` placeholder на вызов Anchor instruction `submit_proposal`.

## Devnet/localnet: поднятие и деплой (Anchor)

Ниже — пошаговый путь, чтобы:

- поднять локальный devnet (local validator),
- задеплоить минимальную on-chain программу Stage 6,
- понять какие account’ы требуются для `submit_proposal`.

### 1) Предварительные требования

- `solana` CLI
- `anchor` CLI
- Rust toolchain (`cargo`, `rustc`)

### 2) Поднять локальный devnet (local validator)

1. Запустите валидатор:

```powershell
solana-test-validator --reset
```

2. Убедитесь, что CLI и Anchor смотрят в локальный RPC:

```powershell
solana config set --url http://127.0.0.1:8899
```

3. Добавьте/подготовьте wallet, который будет `payer` для деплоя:

```powershell
solana-keygen new --outfile .\anchor_local_wallet.json
solana config set --keypair .\anchor_local_wallet.json
solana airdrop 2
```

### 3) Деплой Anchor program

Предположим, исходники anchor-программы лежат в папке `anchor/programs/proposal-submission`.

Важно: в Anchor-каркасе в репозитории сейчас стоит placeholder `declare_id!`/program id в `anchor/Anchor.toml`.
Перед первым деплоем приведите их к реальному program id (обычно это делается через `anchor keys`/`anchor init` или заменой значения под свой program keypair).

1. Соберите:

```powershell
anchor build
```

2. Задеплойте на localnet:

```powershell
anchor deploy --provider.cluster localnet
```

### 4) Какие account’ы требуются для `submit_proposal`

На instruction уровне нужны:

- `submission` (PDA, writable, init)
  - seed’ы: `["proposal_submission", DATA_VERSION=1, proposalIdHash, contentHash]`
- `payer` (signer, writable)
  - платит rent/fees за создание PDA
- `system_program` (readonly)

Опционально (зависит от шаблона/Anchor версии):
- sysvar’ы `rent`, `clock` (clock используется внутри через `Clock::get()`).

### 5) Минимальный payload данных (как backend готовит args)

- `proposal_id_hash = sha256(UTF8(proposal.id))` => `[u8;32]`
- `content_hash = sha256(UTF8(stableJson(canonicalInput)))` => `[u8;32]`
  - `canonicalInput` для Stage 6 v1:
    - `proposal.authorPubkey = Proposal.authorPubkey`
    - `proposal.scope = Proposal.scope`
    - `proposal.title = Proposal.title ?? null`
    - `proposal.description = Proposal.description ?? null`
    - `actions = []`
- `signature_hash = sha256(signatureBytes)` => `[u8;32]`
- `author_pubkey = Pubkey(Proposal.authorPubkey)`
- `status = 1` (SUBMITTED)

### Переменные окружения (runtime для BackendAPIAgent)

Для реального on-chain submit (backend -> Anchor) потребуются:

- `NEXT_PUBLIC_SOLANA_RPC` или `SOLANA_RPC_URL`
  - RPC URL для отправки tx
- `SOLANA_SUBMISSION_PAYER_PRIVATE_KEY_B58` (или `SOLANA_SUBMISSION_PAYER_PRIVATE_KEY`)
  - серверный keypair, который будет `payer` в on-chain instruction
- `SOLANA_STAGE6_ANCHOR_PROGRAM_ID`
  - ProgramId Anchor program v1 (pubkey)
- `SOLANA_STAGE6_ANCHOR_IDL_PATH`
  - путь к IDL JSON файла Anchor program v1 (чтобы backend мог создать Anchor Program instance)
