import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireStudioUser } from '@/lib/studio/supabase-server';
import { downloadFromBucket, studioFileUrl, uploadToBucket } from '@/lib/studio/storage';

const bodySchema = z.object({ generationId: z.string().uuid() });

/** "Dodaj do inspiracji" — kopiuje wygenerowaną wizualizację do zestawu. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/studio/inspirations/[id]/add-generation'>) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;
  const { id: setId } = await ctx.params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania.' }, { status: 400 });
  }

  const { data: set } = await auth.supabase
    .from('inspiration_sets')
    .select('id, cover_image_id')
    .eq('id', setId)
    .maybeSingle();
  if (!set) {
    return NextResponse.json({ error: 'Nie znaleziono zestawu.' }, { status: 404 });
  }

  const { data: gen } = await auth.supabase
    .from('generations')
    .select('id, storage_path, width, height, status')
    .eq('id', parsed.data.generationId)
    .maybeSingle();
  if (!gen || gen.status !== 'done' || !gen.storage_path) {
    return NextResponse.json({ error: 'Wizualizacja nie jest gotowa.' }, { status: 400 });
  }

  const file = await downloadFromBucket(auth.supabase, 'generations', gen.storage_path);
  const path = `${setId}/${randomUUID()}.png`;
  await uploadToBucket(auth.supabase, 'inspirations', path, file.data, file.mimeType);

  const { data: row, error } = await auth.supabase
    .from('inspiration_images')
    .insert({ set_id: setId, storage_path: path, width: gen.width, height: gen.height })
    .select()
    .single();
  if (error || !row) {
    return NextResponse.json({ error: `Nie udało się dodać do zestawu: ${error?.message}` }, { status: 500 });
  }

  if (!set.cover_image_id) {
    await auth.supabase.from('inspiration_sets').update({ cover_image_id: row.id }).eq('id', setId);
  }

  return NextResponse.json({ image: { ...row, image_url: studioFileUrl('inspirations', path) } });
}
