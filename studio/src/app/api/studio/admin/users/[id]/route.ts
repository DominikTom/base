import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStudioAdmin } from '@/lib/studio/supabase-server';

const patchSchema = z.union([
  z.object({ action: z.literal('set-password'), password: z.string().min(8).max(72) }),
  z.object({ action: z.literal('rename'), name: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal('set-admin'), value: z.boolean() }),
]);

export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/studio/admin/users/[id]'>) {
  const auth = await requireStudioAdmin();
  if (auth instanceof NextResponse) return auth;
  if (!process.env.SUPABASE_SERVICE_KEY) {
    return NextResponse.json(
      { error: 'Brak klucza serwisowego (env SUPABASE_SERVICE_KEY w projekcie Vercel).' },
      { status: 500 }
    );
  }
  const service = getSupabaseAdmin();

  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania.' }, { status: 400 });
  }
  const input = parsed.data;

  if (input.action === 'set-password') {
    const { error } = await service.auth.admin.updateUserById(id, { password: input.password });
    if (error) {
      return NextResponse.json({ error: `Nie udało się zmienić hasła: ${error.message}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (input.action === 'rename') {
    const { error } = await service
      .from('profiles')
      .upsert({ id, display_name: input.name }, { onConflict: 'id' });
    if (error) {
      return NextResponse.json({ error: `Nie udało się zmienić nazwy: ${error.message}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // set-admin — nie można odebrać uprawnień samemu sobie (zostałby system bez admina).
  if (id === auth.user.id && !input.value) {
    return NextResponse.json(
      { error: 'Nie możesz odebrać uprawnień administratora samemu sobie.' },
      { status: 400 }
    );
  }
  const { error } = await service
    .from('profiles')
    .upsert({ id, is_admin: input.value }, { onConflict: 'id' });
  if (error) {
    return NextResponse.json({ error: `Nie udało się zmienić uprawnień: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
