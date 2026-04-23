import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { STAFF_SESSION_COOKIE } from '@/lib/staff-session-constants';

/**
 * Ранний редирект без cookie; валидность токена проверяется в layout и `/api/admin/*`.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === '/admin/login' || pathname.startsWith('/admin/login/')) {
    return NextResponse.next();
  }
  if (!request.cookies.get(STAFF_SESSION_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = '/admin/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};
