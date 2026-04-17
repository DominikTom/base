import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export interface UserProfile {
  user_id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'viewer';
  dashboard_layout: Record<string, unknown> | null;
}

export async function getUserProfile(): Promise<UserProfile | null> {
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return null;

    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() { /* read-only */ },
      },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (profile) return profile as UserProfile;

    // Auto-create profile on first login
    const newProfile: UserProfile = {
      user_id: user.id,
      email: user.email || '',
      display_name: null,
      role: 'viewer',
      dashboard_layout: null,
    };

    await supabase.from('user_profiles').insert(newProfile);
    return newProfile;
  } catch {
    return null;
  }
}
