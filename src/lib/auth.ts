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
// Akceptujemy dwie ścieżki uwierzytelnienia:
//   1. Bearer token = CRON_SECRET lub ETL_CRON_SECRET. Vercel Cron wysyła
//      `Authorization: Bearer $CRON_SECRET`, gdy zmienna CRON_SECRET jest
//      ustawiona na projekcie. To jedyna część żądania, której obcy nadawca
//      nie podrobi.
//   2. Sesja Supabase z rolą 'admin' w user_profiles.
//
// USUNIĘTE: `x-vercel-cron: 1` oraz user-agent `vercel-cron/...`. Oba to zwykłe
// nagłówki żądania — Vercel je ustawia przy własnych wywołaniach, ale ich nie
// filtruje na wejściu, więc dowolny nadawca mógł je wysłać i uruchomić każdy
// chroniony endpoint (ETL, sync Meta/GA4, sales-sync). To był w praktyce brak
// autoryzacji z wyglądem autoryzacji.
//
// Regresja e144b5d z 2026-06-08, opisana tu wcześniej, brała się stąd, że
// Vercel wysyła nagłówek Authorization TYLKO gdy CRON_SECRET istnieje. Warunek
// jest więc taki: ustaw CRON_SECRET na projekcie ZANIM to wdrożysz, inaczej
// crony znowu dostaną 401. Szczegóły w docs/RUNBOOK-etl.md.
import { NextResponse } from 'next/server';

/** Porównanie w stałym czasie — sekret nie wycieka kanałem czasowym. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function requireAdmin(): Promise<NextResponse | null> {
  const h = await headers();

  const authHeader = h.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const accepted = [process.env.CRON_SECRET, process.env.ETL_CRON_SECRET].filter(
      (s): s is string => typeof s === 'string' && s.length > 0
    );
    // Bez short-circuitu: liczba porównań nie zależy od tego, który pasował.
    if (accepted.reduce((ok, secret) => safeEqual(token, secret) || ok, false)) return null;
  }

  const { user, supabase } = await getAuthUser();
  if (!user) {
    console.warn('[requireAdmin] 401', {
      userAgent: (h.get('user-agent') || '').slice(0, 60),
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
