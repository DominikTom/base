import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStudioUser } from '@/lib/studio/supabase-server';

const patchSchema = z.object({
  action: z.enum(['trash', 'restore']),
});

export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/studio/packshots/[id]'>) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania.' }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from('packshots')
    .update({ deleted_at: parsed.data.action === 'trash' ? new Date().toISOString() : null })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: `Operacja nie powiodła się: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
