import { redirect } from 'next/navigation';

import { getValidStaffSessionFromCookies } from '@/lib/staff-session-server';

/** Раздел новостей в админке отключён: кэш только через cron / публичный API. */
export default async function AdminNewsPage() {
  const s = await getValidStaffSessionFromCookies();
  if (!s) redirect('/admin/login');
  redirect('/admin/overview');
}
