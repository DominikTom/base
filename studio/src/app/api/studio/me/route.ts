import { NextResponse } from 'next/server';
import { requireStudioUser } from '@/lib/studio/supabase-server';

/** Kim jestem: e-mail, nazwa wyświetlana, uprawnienia (np. link Administracja w menu). */
export async function GET() {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const { data } = await auth.supabase
    .from('profiles')
    .select('display_name, is_admin')
    .eq('id', auth.user.id)
    .maybeSingle();

  return NextResponse.json({
    id: auth.user.id,
    email: auth.user.email ?? null,
    displayName: data?.display_name ?? null,
    isAdmin: Boolean(data?.is_admin),
  });
}
