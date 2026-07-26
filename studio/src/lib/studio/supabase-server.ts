import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * Klient Supabase związany z sesją użytkownika (cookies) — wszystkie zapytania
 * przechodzą przez RLS. Używać we wszystkich route handlerach studia.
 */
export async function getStudioSupabase(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Wywołanie z Server Component — sesję odświeży proxy.
        }
      },
    },
  });
}

export interface StudioAuth {
  supabase: SupabaseClient;
  user: User;
}

/**
 * Zwraca klienta + zalogowanego użytkownika albo Response 401.
 */
export async function requireStudioUser(): Promise<StudioAuth | NextResponse> {
  const supabase = await getStudioSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Musisz być zalogowany.' }, { status: 401 });
  }
  return { supabase, user };
}
