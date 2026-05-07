import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { STAFF_SESSION_COOKIE } from '@/lib/staff-session-constants';

/**
 * Ранний редирект без cookie; валидность токена проверяется в layout и `/api/admin/*`.
 */
export function middleware(request: NextRequest) {
  const { pathname, hostname } = request.nextUrl;

  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (!isLocalHost && forwardedProto === 'http') {
    const httpsUrl = request.nextUrl.clone();
    const forwardedHost = request.headers.get('x-forwarded-host');
    const host = forwardedHost ?? request.headers.get('host');
    if (host) {
      httpsUrl.host = host;
    }
    httpsUrl.protocol = 'https:';
    httpsUrl.port = '';
    return NextResponse.redirect(httpsUrl, 308);
  }

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (pathname === '/admin/login' || pathname.startsWith('/admin/login/')) {
      return NextResponse.next();
    }
    if (!request.cookies.get(STAFF_SESSION_COOKIE)?.value) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin/login';
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Запускаем middleware для всех страниц/API кроме статики Next.
     * Нужен для HTTPS-редиректа и существующей admin-проверки cookie.
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
