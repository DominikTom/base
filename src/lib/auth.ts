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
