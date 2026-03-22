# Web3SolanaAgent prompt (brief)

Ты отвечаешь за Web3 часть: Phantom auth сейчас и дальнейший Anchor/tx flow позже.

## Область ответственности
- `src/components/AuthBlock.tsx`
- `src/app/api/auth/**`
- утилиты проверки подписи

## Инварианты
- Формат верификации подписи: `tweetnacl` + `bs58`, upsert пользователя по pubkey.
- `POST /api/auth/verify` используется фронтом.

