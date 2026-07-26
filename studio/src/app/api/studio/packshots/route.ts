import { imageSize } from 'image-size';
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireStudioUser } from '@/lib/studio/supabase-server';
import {
  ALLOWED_IMAGE_TYPES,
  extForMime,
  MAX_UPLOAD_BYTES,
  studioFileUrl,
  uploadToBucket,
} from '@/lib/studio/storage';
import type { PackshotRow } from '@/lib/studio/types';

export async function GET() {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await auth.supabase
    .from('packshots')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: `Nie udało się pobrać packshotów: ${error.message}` }, { status: 500 });
  }

  const packshots = (data as PackshotRow[]).map((p) => ({
    ...p,
    image_url: studioFileUrl('packshots', p.storage_path),
  }));
  return NextResponse.json({ packshots });
}

export async function POST(request: NextRequest) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Oczekiwano multipart/form-data z plikiem.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Brak pliku w polu "file".' }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: 'Nieobsługiwany format. Dozwolone: PNG, JPG, WEBP.' },
      { status: 400 }
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'Plik jest za duży (limit 20 MB).' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let width: number | null = null;
  let height: number | null = null;
  try {
    const dim = imageSize(buffer);
    width = dim.width ?? null;
    height = dim.height ?? null;
  } catch {
    return NextResponse.json({ error: 'Plik nie wygląda na poprawny obraz.' }, { status: 400 });
  }

  const path = `${auth.user.id}/${randomUUID()}.${extForMime(file.type)}`;
  try {
    await uploadToBucket(auth.supabase, 'packshots', path, buffer, file.type);
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }

  const { data, error } = await auth.supabase
    .from('packshots')
    .insert({
      user_id: auth.user.id,
      storage_path: path,
      original_filename: file.name,
      width,
      height,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: `Nie udało się zapisać packshota: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    packshot: { ...(data as PackshotRow), image_url: studioFileUrl('packshots', path) },
  });
}
