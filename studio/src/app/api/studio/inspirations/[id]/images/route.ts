import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStudioUser } from '@/lib/studio/supabase-server';
import { removeFromBucket, studioFileUrl } from '@/lib/studio/storage';

type Ctx = RouteContext<'/api/studio/inspirations/[id]/images'>;

const registerSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(500),
        width: z.number().int().positive().nullish(),
        height: z.number().int().positive().nullish(),
      })
    )
    .min(1, 'Brak plików do zarejestrowania.')
    .max(30, 'Maksymalnie 30 plików naraz.'),
});

/**
 * Rejestracja obrazów wgranych client-side do bucketu `inspirations`
 * (upload z przeglądarki omija limit 4,5 MB body Vercela).
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;
  const { id: setId } = await ctx.params;

  const { data: set } = await auth.supabase
    .from('inspiration_sets')
    .select('id, cover_image_id')
    .eq('id', setId)
    .maybeSingle();
  if (!set) {
    return NextResponse.json({ error: 'Nie znaleziono zestawu.' }, { status: 404 });
  }

  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' },
      { status: 400 }
    );
  }

  const uploaded = [];
  const errors: string[] = [];
  for (const file of parsed.data.files) {
    if (
      !file.path.startsWith(`${setId}/`) ||
      file.path.includes('..') ||
      !/\.(png|jpg|jpeg|webp)$/i.test(file.path)
    ) {
      errors.push(`${file.path}: nieprawidłowa ścieżka`);
      continue;
    }
    const exists = await auth.supabase.storage.from('inspirations').createSignedUrl(file.path, 60);
    if (exists.error) {
      errors.push(`${file.path}: nie znaleziono pliku w Storage`);
      continue;
    }
    const { data: row, error } = await auth.supabase
      .from('inspiration_images')
      .insert({
        set_id: setId,
        storage_path: file.path,
        width: file.width ?? null,
        height: file.height ?? null,
      })
      .select()
      .single();
    if (error || !row) {
      errors.push(`${file.path}: zapis do bazy nie powiódł się`);
      continue;
    }
    uploaded.push({ ...row, image_url: studioFileUrl('inspirations', file.path) });
  }

  // Pierwszy obraz zestawu zostaje okładką.
  if (!set.cover_image_id && uploaded.length > 0) {
    await auth.supabase
      .from('inspiration_sets')
      .update({ cover_image_id: uploaded[0].id })
      .eq('id', setId);
  }

  return NextResponse.json({ images: uploaded, errors });
}

const deleteSchema = z.object({ imageId: z.string().uuid() });

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;
  const { id: setId } = await ctx.params;

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania.' }, { status: 400 });
  }

  const { data: img } = await auth.supabase
    .from('inspiration_images')
    .select('id, storage_path')
    .eq('id', parsed.data.imageId)
    .eq('set_id', setId)
    .maybeSingle();
  if (!img) {
    return NextResponse.json({ error: 'Nie znaleziono obrazu.' }, { status: 404 });
  }

  const { error } = await auth.supabase.from('inspiration_images').delete().eq('id', img.id);
  if (error) {
    return NextResponse.json({ error: `Usuwanie nie powiodło się: ${error.message}` }, { status: 500 });
  }
  await removeFromBucket(auth.supabase, 'inspirations', [img.storage_path]);
  return NextResponse.json({ ok: true });
}
