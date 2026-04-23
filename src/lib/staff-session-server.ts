import { cookies } from 'next/headers';

import { STAFF_SESSION_COOKIE, findValidStaffSessionByRawToken } from '@/lib/staff-session';

/** Server Components / layouts: resolve current admin session from httpOnly cookie. */
export async function getValidStaffSessionFromCookies() {
  const store = await cookies();
  const raw = store.get(STAFF_SESSION_COOKIE)?.value ?? null;
  if (!raw) return null;
  return findValidStaffSessionByRawToken(raw);
}
