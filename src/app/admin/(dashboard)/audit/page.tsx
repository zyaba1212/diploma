import { redirect } from 'next/navigation';

import { AdminAuditClient } from '@/components/admin/AdminAuditClient';
import { getValidStaffSessionFromCookies } from '@/lib/staff-session-server';

export default async function AdminAuditPage() {
  const s = await getValidStaffSessionFromCookies();
  if (!s) redirect('/admin/login');
  return <AdminAuditClient />;
}
