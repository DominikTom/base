import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

async function getAuthUser() {
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
  const { data: { user } } = await supabase.auth.getUser();
  return { user, supabase };
}

async function ensureProfile(supabase: ReturnType<typeof createServerClient>, userId: string, email: string) {
  const { data: existing } = await supabase
    .from('user_profiles')
    .select('user_id')
    .eq('user_id', userId)
    .single();

  if (!existing) {
    await supabase.from('user_profiles').insert({
      user_id: userId,
      email,
      role: 'viewer',
    });
  }
}

// GET — fetch user profile + role + layout
export async function GET() {
  try {
    const { user, supabase } = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    await ensureProfile(supabase, user.id, user.email || '');

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();

    return NextResponse.json({
      user: { id: user.id, email: user.email },
      profile: profile || { role: 'viewer', dashboard_layout: null },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST — dashboard layout operations
export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    await ensureProfile(supabase, user.id, user.email || '');

    const body = await request.json();

    if (body.action === 'save_dashboard_data') {
      // Upsert to handle case where profile row might not exist
      const { error } = await supabase
        .from('user_profiles')
        .upsert({
          user_id: user.id,
          email: user.email || '',
          dashboard_layout: body.data,
        }, { onConflict: 'user_id' });

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    // Legacy: save single layout
    if (body.action === 'save_layout') {
      const { error } = await supabase
        .from('user_profiles')
        .upsert({
          user_id: user.id,
          email: user.email || '',
          dashboard_layout: body.layout,
        }, { onConflict: 'user_id' });

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
