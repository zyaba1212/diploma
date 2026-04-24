import { redirect } from 'next/navigation';

import { AdminProposalDetailClient } from '@/components/admin/AdminProposalDetailClient';
import { getValidStaffSessionFromCookies } from '@/lib/staff-session-server';

type Props = { params: Promise<{ id: string }> };

export default async function AdminProposalDetailPage({ params }: Props) {
  const s = await getValidStaffSessionFromCookies();
  if (!s) redirect('/admin/login');
  const { id } = await params;
  return <AdminProposalDetailClient proposalId={id} />;
}
