/** Правила ника (Auth / Profile, согласовано с архитектурой: off-chain подпись). */
const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

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
