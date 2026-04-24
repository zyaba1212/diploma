import type { StaffRole, StaffSession } from '@prisma/client';

/** Роли, которым разрешён UI и общие staff-эндпоинты админ-панели. */
export const STAFF_PORTAL_ROLES: readonly StaffRole[] = ['ADMIN', 'MODERATOR'];

export function isStaffPortalRole(role: StaffRole): boolean {
  return role === 'ADMIN' || role === 'MODERATOR';
}

export function isStaffPortalSession(session: StaffSession | null | undefined): session is StaffSession {
  return Boolean(session && isStaffPortalRole(session.role));
}
