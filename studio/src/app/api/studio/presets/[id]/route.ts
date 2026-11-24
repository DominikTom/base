import { NextResponse, type NextRequest } from 'next/server';
import { requireStudioUser } from '@/lib/studio/supabase-server';

export async function DELETE(_request: NextRequest, ctx: RouteContext<'/api/studio/presets/[id]'>) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  const { error } = await auth.supabase.from('editor_presets').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: `Nie udało się usunąć presetu: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
