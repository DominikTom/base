import { createServerClient } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';

// Uwierzytelnienie żądania API na podstawie ciasteczek sesji Supabase.
// Ten sam wzorzec co getAuthUser() w /api/user — wydzielony do współdzielenia
// przez nowe trasy (asystent AI, rejestr KPI).
export async function getAuthUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch { /* Server Component — zapis ciasteczek pomijany */ }
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return { user, supabase };
}

// Czy zalogowany użytkownik ma rolę 'admin' (z tabeli user_profiles).
export async function isAdmin(
  supabase: Awaited<ReturnType<typeof getAuthUser>>['supabase'],
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('user_id', userId)
    .single();
  return data?.role === 'admin';
}

// Strażnik admin-only API. Zwraca null gdy OK; gdy nie-admin / nie-zalogowany
// zwraca gotowy NextResponse z odpowiednim kodem 401/403.
//
// Akceptujemy cztery ścieżki uwierzytelnienia:
//   1. Vercel Cron header `x-vercel-cron: 1` (wewnętrzne wywołanie z Vercel).
//   2. Vercel Cron user-agent `vercel-cron/...` (fallback gdy header zniknie).
//   3. Bearer token = ETL_CRON_SECRET lub CRON_SECRET (manualny curl / Vercel
//      CRON_SECRET env, który Vercel automatycznie wstrzykuje do Authorization).
//   4. Sesja Supabase z rolą 'admin' w user_profiles.
//
// Punkty 1-3 są kluczowe — bez nich Vercel Cron dostawał 401 i wszystkie
// scheduled ETL syncs były zablokowane (regresja w commicie e144b5d od 2026-06-08).
import { NextResponse } from 'next/server';
export async function requireAdmin(): Promise<NextResponse | null> {
  const h = await headers();

  if (h.get('x-vercel-cron') === '1') return null;

  const userAgent = h.get('user-agent') || '';
  if (userAgent.startsWith('vercel-cron')) return null;

  const authHeader = h.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (process.env.ETL_CRON_SECRET && token === process.env.ETL_CRON_SECRET) return null;
    if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return null;
  }

  const { user, supabase } = await getAuthUser();
  if (!user) {
    console.warn('[requireAdmin] 401', {
      xVercelCron: h.get('x-vercel-cron'),
      userAgent: userAgent.slice(0, 60),
      authPresent: !!authHeader,
      hasEtlSecret: !!process.env.ETL_CRON_SECRET,
      hasCronSecret: !!process.env.CRON_SECRET,
    });
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!(await isAdmin(supabase, user.id))) {
    return NextResponse.json({ error: 'Forbidden — wymagana rola admin' }, { status: 403 });
  }
  return null;
}
