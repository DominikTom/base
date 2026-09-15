import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge authorization gate.
 *
 * Three defects fixed here:
 *
 *  1. The session was fetched, then the redirect was gated on
 *     `pathname.startsWith('/dashboard')`. Every API route lives under
 *     `/api/dashboard/...`, which does not match that prefix, so the lookup
 *     result was thrown away and the whole API answered anyone. 17 of the
 *     `/api/dashboard/*` routes carry no auth check of their own and relied
 *     entirely on this gate — including order history with customer names,
 *     cities and delivery addresses, and
 *     `/api/dashboard/database?action=preview&table=...` as a generic table
 *     reader.
 *  2. `/api/etl/` was allow-listed wholesale, so the ETL routes were reachable
 *     without a session regardless of what the handlers did.
 *  3. Missing Supabase env vars returned `next()`, i.e. a misconfigured
 *     deployment served everything unauthenticated.
 *
 * This gate is a backstop, not the only check: per the Next.js proxy docs a
 * matcher edit can silently drop coverage, so privileged handlers keep their
 * own requireAdmin()/getAuthUser() calls.
 */

/** Reachable without a session. */
const PUBLIC_PATHS = ['/login', '/auth/', '/api/health'];

/** API namespaces that require a signed-in user or a valid bearer secret. */
const PROTECTED_API_PREFIXES = [
  '/api/dashboard',
  '/api/etl',
  '/api/sensmax',
  '/api/jobs',
  '/api/user',
  '/api/assistant',
  '/api/kpi',
  '/api/insights',
  '/api/weather',
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === '/' || PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const isProtectedApi = PROTECTED_API_PREFIXES.some(p => pathname.startsWith(p));
  const isDashboardPage = pathname.startsWith('/dashboard');

  if (!isProtectedApi && !isDashboardPage) {
    return NextResponse.next();
  }

  // Machine callers (Vercel Cron, manual curl with the ETL secret) present a
  // bearer token instead of a session cookie. Let those reach the handler so
  // requireAdmin() validates the secret — this gate must not be the thing that
  // decides a bearer token is good.
  const authorization = request.headers.get('authorization');
  if (isProtectedApi && authorization?.startsWith('Bearer ')) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Fail closed: without Supabase configured we cannot authenticate anyone.
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[proxy] Supabase env vars missing — denying authenticated route');
    return denied(request, pathname, isDashboardPage);
  }

  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return denied(request, pathname, isDashboardPage);
  }

  return response;
}

/** Pages bounce to the login screen; APIs get a 401 rather than an HTML redirect. */
function denied(request: NextRequest, pathname: string, isDashboardPage: boolean) {
  if (isDashboardPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/dashboard/:path*',
    '/api/etl/:path*',
    '/api/sensmax/:path*',
    '/api/jobs/:path*',
    '/api/assistant/:path*',
    '/api/weather/:path*',
    '/api/user',
    '/api/user/:path*',
    '/api/kpi',
    '/api/kpi/:path*',
    '/api/insights',
    '/api/insights/:path*',
    '/login',
  ],
};
