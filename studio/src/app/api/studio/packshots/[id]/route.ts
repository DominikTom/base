import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStudioUser } from '@/lib/studio/supabase-server';

const patchSchema = z.union([
  z.object({ action: z.enum(['trash', 'restore']) }),
  z.object({ action: z.literal('rename'), name: z.string().trim().min(1).max(300) }),
]);

export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/studio/packshots/[id]'>) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania.' }, { status: 400 });
  }

  const update =
    parsed.data.action === 'rename'
      ? { original_filename: parsed.data.name }
      : { deleted_at: parsed.data.action === 'trash' ? new Date().toISOString() : null };

  const { error } = await auth.supabase.from('packshots').update(update).eq('id', id);

  if (error) {
    return NextResponse.json({ error: `Operacja nie powiodła się: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
