import { redirect } from 'next/navigation';

import { AdminSessionsClient } from '@/components/admin/AdminSessionsClient';
import { getValidStaffSessionFromCookies } from '@/lib/staff-session-server';

export default async function AdminSessionsPage() {
  const s = await getValidStaffSessionFromCookies();
  if (!s) redirect('/admin/login');
  return <AdminSessionsClient />;
}
