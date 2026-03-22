# Autoconnect / бездействие — промпт для агента (копипаст)

**Исполнитель по умолчанию:** `Web3SolanaAgent` (кошелёк, адаптер, autoconnect). При чисто UI-правках без семантики кошелька — по согласованию `FrontendAgent`.

Используй, когда нужно **доработать политику autoconnect** (таймаут, ключи storage, UX).

## Что уже сделано в репозитории

- **`src/lib/wallet-autoconnect-policy.ts`** — `WALLET_IDLE_MS` (30 мин), ключ `diploma_walletLastActivityAt`, throttle записи активности.
- **`WalletStaleAutoconnectGuard`** — **до** монтирования `WalletProvider`: если с последней активности прошло > `WALLET_IDLE_MS`, из `localStorage` удаляется **`walletName`** (стандартный ключ `@solana/wallet-adapter-react`), чтобы при следующем заходе **не было autoconnect**.
- **`WalletIdleAutoconnect`** — внутри `WalletProvider`: слушает активность, по истечении 30 мин бездействия вызывает **`disconnect()`** (как при «Отключить») — сбрасывается сохранённый кошелёк.
- **Ручное отключение** кошелька: `disconnect()` уже приводит к `setWalletName(null)` в адаптере — отдельный код не обязателен.

## Общий промпт (вставить в чат агенту)

```
Ты работаешь по файлу docs/agents/wallet-autoconnect-prompt.md и коду в src/app/providers.tsx,
src/components/WalletStaleAutoconnectGuard.tsx, src/components/WalletIdleAutoconnect.tsx,
src/lib/wallet-autoconnect-policy.ts.

1) Прочитай wallet-autoconnect-prompt.md и перечисленные файлы.
2) Задача: [опиши изменение — например: изменить WALLET_IDLE_MS, добавить событие активности, синхронизировать localStorageKey с WalletProvider].
3) После правок: npm run lint && npm run build; краткая запись в DEVELOPMENT_JOURNAL.md.

Разрешение на правки: от координатора.
```

## Где «общий промпт» для агентов по проекту

- **Auth / Profile:** `docs/agents/auth-profile-phase-prompts.md` → блок «Общий промпт».
- **UX / Globe:** `docs/agents/ux-globe-phase-prompts.md` → общий промпт в начале файла.
- **Как делегировать:** см. `AGENTS.md` → «Как «делегировать» роли в Cursor» — открыть **новый чат**, вставить роль + ссылку на нужный `docs/agents/*.md`.

В Cursor **нет одного глобального** системного промпта для «всех агентов сразу»: координатор копирует общий блок из соответствующего `docs/agents/*-prompts.md` в чат.
