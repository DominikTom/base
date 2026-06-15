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
// Akceptujemy trzy ścieżki uwierzytelnienia:
//   1. Vercel Cron — wewnętrzny header `x-vercel-cron: 1` (bez sesji userskiej).
//   2. Bearer token = ETL_CRON_SECRET (do ręcznego curl'a/Cron'a zewnętrznego).
//   3. Sesja Supabase z rolą 'admin' w user_profiles.
//
// Punkty 1+2 są kluczowe — bez nich Vercel Cron dostawał 401 i wszystkie
// scheduled ETL syncs były zablokowane (regresja w commicie e144b5d).
import { NextResponse } from 'next/server';
export async function requireAdmin(): Promise<NextResponse | null> {
  const h = await headers();
  if (h.get('x-vercel-cron') === '1') return null;

  const cronSecret = process.env.ETL_CRON_SECRET;
  if (cronSecret) {
    const authHeader = h.get('authorization');
    if (authHeader === `Bearer ${cronSecret}`) return null;
  }

  const { user, supabase } = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(supabase, user.id))) {
    return NextResponse.json({ error: 'Forbidden — wymagana rola admin' }, { status: 403 });
  }
  return null;
}
