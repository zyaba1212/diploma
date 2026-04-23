import { redirect } from 'next/navigation';

import { AdminDashboardShell } from '@/components/AdminDashboardShell';
import { prisma } from '@/lib/prisma';
import { isStaffPortalSession } from '@/lib/staff-portal-access';
import { getValidStaffSessionFromCookies } from '@/lib/staff-session-server';
import { getUserBanDetails } from '@/lib/user-ban';

export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getValidStaffSessionFromCookies();
  if (!isStaffPortalSession(session)) redirect('/admin/login');
  const s = session;

  let staffUsername: string | null = null;
  if (s.pubkey) {
    const ban = await getUserBanDetails(s.pubkey);
    if (ban) redirect(`/blocked?pubkey=${encodeURIComponent(s.pubkey)}`);

    const u = await prisma.user.findUnique({
      where: { pubkey: s.pubkey },
      select: { username: true },
    });
    staffUsername = u?.username ?? null;
  }

  return (
    <AdminDashboardShell role={s.role} staffUsername={staffUsername} staffPubkey={s.pubkey}>
      {children}
    </AdminDashboardShell>
  );
}
