import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

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
// Użycie w POST/GET routes:
//   const guard = await requireAdmin();
//   if (guard) return guard;
//   // ... reszta handlera, user jest adminem
import { NextResponse } from 'next/server';
export async function requireAdmin(): Promise<NextResponse | null> {
  const { user, supabase } = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!(await isAdmin(supabase, user.id))) {
    return NextResponse.json({ error: 'Forbidden — wymagana rola admin' }, { status: 403 });
  }
  return null;
}
