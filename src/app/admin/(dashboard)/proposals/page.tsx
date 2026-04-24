import { redirect } from 'next/navigation';

import { AdminProposalsClient } from '@/components/admin/AdminProposalsClient';
import { getValidStaffSessionFromCookies } from '@/lib/staff-session-server';

export default async function AdminProposalsPage() {
  const s = await getValidStaffSessionFromCookies();
  if (!s) redirect('/admin/login');
  return <AdminProposalsClient />;
}
