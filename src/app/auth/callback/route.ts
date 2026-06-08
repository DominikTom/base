import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

// Email może się zalogować tylko z domen MyBed. Sprawdzamy TUTAJ a nie po
// stronie klienta — Supabase OAuth nie ma niezawodnego sposobu wymuszenia
// `hd` (hosted domain) parametru per provider, więc weryfikujemy po
// pomyślnej wymianie code → session.
const ALLOWED_DOMAINS = ['mybed.pl', 'mybed.de', 'mittohome.pl'];

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard/overview';

  if (code) {
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
            } catch { /* Server component limitation */ }
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const email = (user.email || '').toLowerCase();
        const domain = email.split('@')[1] || '';

        // Restrict do domen MyBed. Jeśli mail nie pasuje — wyloguj i
        // pokaż błąd na ekranie loginu.
        if (!ALLOWED_DOMAINS.includes(domain)) {
          await supabase.auth.signOut();
          return NextResponse.redirect(`${origin}/login?error=domain`);
        }

        const { data: existing } = await supabase
          .from('user_profiles')
          .select('user_id')
          .eq('user_id', user.id)
          .single();

        if (!existing) {
          await supabase.from('user_profiles').insert({
            user_id: user.id,
            email: user.email || '',
            role: 'viewer',
          });
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
