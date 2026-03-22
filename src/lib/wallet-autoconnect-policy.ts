/**
 * Политика autoconnect: ключи localStorage и таймаут бездействия.
 * @solana/wallet-adapter-react по умолчанию хранит выбранный кошелёк в localStorage (ключ `walletName`).
 * Мы дополнительно храним время последней активности пользователя на сайте.
 */

/** 30 минут — после этого autoconnect не должен срабатывать при следующем заходе / вкладка простаивает. */
export const WALLET_IDLE_MS = 30 * 60 * 1000;

/** Время последней активности (mousemove, клики и т.д.), чтобы сбросить autoconnect между сессиями. */
export const WALLET_LAST_ACTIVITY_KEY = 'diploma_walletLastActivityAt';

/** Как часто обновлять метку активности в storage (снижает нагрузку на localStorage). */
export const ACTIVITY_PERSIST_THROTTLE_MS = 60_000;
