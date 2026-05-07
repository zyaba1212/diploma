/** Правила ника (Auth / Profile, согласовано с архитектурой: off-chain подпись). */
const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

/**
 * Политика смены никнейма.
 * Никнейм можно менять, но не чаще чем 1 раз в указанный интервал
 * (по умолчанию 30 суток = 1 месяц). Повторная попытка до истечения интервала
 * отклоняется с указанием оставшегося времени до следующей разрешённой смены.
 */
export const USERNAME_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeUsername(raw: string): string {
  return raw.trim();
}

export function validateUsernameFormat(username: string): { ok: true } | { ok: false; error: string } {
  if (!USERNAME_RE.test(username)) {
    return {
      ok: false,
      error: 'username: 3–32 символа, только латиница, цифры и _',
    };
  }
  return { ok: true };
}

export function buildUsernameMessage(pubkey: string, username: string, ts: string): string {
  return `diploma-z96a username\npubkey=${pubkey}\nusername=${username}\nts=${ts}`;
}

/**
 * Возвращает момент (ISO-timestamp в виде Date), после которого следующая смена
 * никнейма будет разрешена. Если `usernameSetAt` отсутствует или кулдаун уже истёк,
 * возвращает `null` — смена доступна немедленно.
 */
export function computeUsernameNextChangeAt(
  usernameSetAt: Date | string | null | undefined,
  nowMs: number = Date.now(),
): Date | null {
  if (!usernameSetAt) return null;
  const setAtMs = usernameSetAt instanceof Date ? usernameSetAt.getTime() : new Date(usernameSetAt).getTime();
  if (!Number.isFinite(setAtMs)) return null;
  const nextMs = setAtMs + USERNAME_CHANGE_COOLDOWN_MS;
  if (nextMs <= nowMs) return null;
  return new Date(nextMs);
}

/** Форматирует миллисекунды в строку вида «23 д 14 ч 05 м 08 с» (обрезая незначащие старшие разряды). */
export function formatUsernameCooldownRemaining(msRemaining: number): string {
  const ms = Math.max(0, Math.floor(msRemaining));
  const totalSeconds = Math.ceil(ms / 1000);
  const days = Math.floor(totalSeconds / (24 * 3600));
  const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad2 = (n: number) => n.toString().padStart(2, '0');
  if (days > 0) return `${days} д ${pad2(hours)} ч ${pad2(minutes)} м`;
  if (hours > 0) return `${hours} ч ${pad2(minutes)} м ${pad2(seconds)} с`;
  if (minutes > 0) return `${minutes} м ${pad2(seconds)} с`;
  return `${seconds} с`;
}
