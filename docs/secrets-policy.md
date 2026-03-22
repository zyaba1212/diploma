# Secrets policy (release hardening)

Цель: исключить утечку секретов в репозиторий, логи и клиентские бандлы.

## Классификация

| Класс | Примеры | Где хранить | В репозитории |
|-------|---------|-------------|---------------|
| **Critical** | `DATABASE_URL`, `SOLANA_SUBMISSION_PAYER_PRIVATE_KEY*`, любые приватные ключи | Secret manager / CI secrets / `.env.local` только локально | **Никогда** |
| **Public-by-design** | `NEXT_PUBLIC_SOLANA_RPC` | Env при сборке | Допустимо только публичные URL (RPC endpoint) |

## Правила

1. **Не коммитить** файлы `.env`, `.env.local`, `.env.production`, дампы БД, ключи в JSON.
2. **Проверять перед push**: `git status` не должен показывать неожиданные `.env*`.
3. **Логи**: не логировать полный `DATABASE_URL`, приватные ключи, полные JWT/куки. Структурированные метрики (`api_metric`) не должны содержать секреты.
4. **Клиент**: только переменные с префиксом `NEXT_PUBLIC_*` попадают в браузер — туда **не** класть секреты сервера.
5. **CI**: секреты только в GitHub Actions **Secrets** / Variables (encrypted), не в workflow YAML в открытом виде.
6. **Ротация**: при компрометации — смена пароля БД, перевыпуск ключей Solana payer, обновление `DATABASE_URL` в секретах деплоя.
7. **Observability hygiene (Stage 10)**: correlation/metric logs должны содержать только технические поля (`route`, `method`, `status`, `durationMs`, `ok`, `note`) без payload с чувствительными данными.

## Чеклист перед релизом

- [ ] В репозитории нет файлов с реальными секретами (поиск по `PRIVATE_KEY`, `postgres://` с паролем).
- [ ] `.gitignore` содержит `.env*` (см. корневой `.gitignore`).
- [ ] Production `DATABASE_URL` выдаётся только через секреты окружения хостинга.
- [ ] Payer-ключ для on-chain submit существует только в server-side env, не в `NEXT_PUBLIC_*`.
- [ ] Structured logs/метрики не содержат секреты, полные query/body с PII, и не печатают значения env.

## Инцидент утечки

1. Немедленно отозвать скомпрометированные креды (БД, Solana).
2. Заменить секреты в деплое и в CI.
3. Зафиксировать инцидент в `DEVELOPMENT_JOURNAL.md` (без вставки реальных значений).
