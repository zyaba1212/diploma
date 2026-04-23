import { redirect } from 'next/navigation';

import { isStaffPortalSession } from '@/lib/staff-portal-access';
import { getValidStaffSessionFromCookies } from '@/lib/staff-session-server';
import { getUserBanDetails } from '@/lib/user-ban';

export default async function AdminPage() {
  const session = await getValidStaffSessionFromCookies();
  if (!isStaffPortalSession(session)) redirect('/admin/login');
  if (session.pubkey && (await getUserBanDetails(session.pubkey))) {
    redirect(`/blocked?pubkey=${encodeURIComponent(session.pubkey)}`);
  }
  redirect('/admin/overview');
}
