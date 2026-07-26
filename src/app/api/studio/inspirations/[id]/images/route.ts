import { imageSize } from 'image-size';
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireStudioUser } from '@/lib/studio/supabase-server';
import {
  ALLOWED_IMAGE_TYPES,
  extForMime,
  MAX_UPLOAD_BYTES,
  removeFromBucket,
  studioFileUrl,
  uploadToBucket,
} from '@/lib/studio/storage';

type Ctx = RouteContext<'/api/studio/inspirations/[id]/images'>;

/** Upload wielu plików naraz do zestawu inspiracji. */
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Oczekiwano multipart/form-data.' }, { status: 400 });
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: 'Brak plików do wgrania.' }, { status: 400 });
  }
  if (files.length > 30) {
    return NextResponse.json({ error: 'Maksymalnie 30 plików naraz.' }, { status: 400 });
  }

  const uploaded = [];
  const errors: string[] = [];
  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      errors.push(`${file.name}: nieobsługiwany format`);
      continue;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      errors.push(`${file.name}: plik przekracza 20 MB`);
      continue;
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    let width: number | null = null;
    let height: number | null = null;
    try {
      const dim = imageSize(buffer);
      width = dim.width ?? null;
      height = dim.height ?? null;
    } catch {
      errors.push(`${file.name}: nie wygląda na poprawny obraz`);
      continue;
    }
    const path = `${setId}/${randomUUID()}.${extForMime(file.type)}`;
    try {
      await uploadToBucket(auth.supabase, 'inspirations', path, buffer, file.type);
    } catch {
      errors.push(`${file.name}: upload nie powiódł się`);
      continue;
    }
    const { data: row, error } = await auth.supabase
      .from('inspiration_images')
      .insert({ set_id: setId, storage_path: path, width, height })
      .select()
      .single();
    if (error || !row) {
      errors.push(`${file.name}: zapis do bazy nie powiódł się`);
      continue;
    }
    uploaded.push({ ...row, image_url: studioFileUrl('inspirations', path) });
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
