import { NextResponse } from 'next/server';
import { requireStudioUser } from '@/lib/studio/supabase-server';

export async function GET() {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await auth.supabase
    .from('rooms')
    .select('id, name, base_prompt, sort_order, icon')
    .order('sort_order', { ascending: true });

  if (error) {
    return NextResponse.json({ error: `Nie udało się pobrać pokoi: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ rooms: data });
}
