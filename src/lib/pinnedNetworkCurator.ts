/**
 * Ники (как в User.username), которым разрешены расширенные операции с закреплёнными сетями.
 * Сравнение без учёта регистра.
 */
const PINNED_NETWORK_CURATOR_USERNAMES_LOWER = new Set(['zyaba123']);

export function usernameIsPinnedNetworkCurator(username: string | null | undefined): boolean {
  const u = username?.trim().toLowerCase();
  if (!u) return false;
  return PINNED_NETWORK_CURATOR_USERNAMES_LOWER.has(u);
}
