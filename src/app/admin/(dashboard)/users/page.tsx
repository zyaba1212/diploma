import { redirect } from 'next/navigation';

import { AdminUsersClient } from '@/components/admin/AdminUsersClient';
import { getValidStaffSessionFromCookies } from '@/lib/staff-session-server';

export default async function AdminUsersPage() {
  const s = await getValidStaffSessionFromCookies();
  if (!s) redirect('/admin/login');
  return <AdminUsersClient canGrantModerator={s.role === 'ADMIN'} />;
}
