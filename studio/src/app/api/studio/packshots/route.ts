import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStudioUser } from '@/lib/studio/supabase-server';
import { studioFileUrl } from '@/lib/studio/storage';
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

const registerSchema = z.object({
  /** Ścieżka pliku wgranego z przeglądarki prosto do bucketu `packshots`. */
  path: z.string().min(1).max(500),
  originalFilename: z.string().max(300).optional(),
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
});

/**
 * Rejestracja packshota wgranego client-side do Storage (upload z przeglądarki
 * omija limit 4,5 MB body na funkcjach serverless Vercela; limit 20 MB pilnuje
 * bucket i walidacja w UI).
 */
export async function POST(request: NextRequest) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe dane packshota.' }, { status: 400 });
  }
  const { path } = parsed.data;

  if (
    !path.startsWith(`${auth.user.id}/`) ||
    path.includes('..') ||
    !/\.(png|jpg|jpeg|webp)$/i.test(path)
  ) {
    return NextResponse.json({ error: 'Nieprawidłowa ścieżka pliku.' }, { status: 400 });
  }

  const exists = await auth.supabase.storage.from('packshots').createSignedUrl(path, 60);
  if (exists.error) {
    return NextResponse.json(
      { error: 'Nie znaleziono pliku w Storage — spróbuj wgrać ponownie.' },
      { status: 400 }
    );
  }

  const { data, error } = await auth.supabase
    .from('packshots')
    .insert({
      user_id: auth.user.id,
      storage_path: path,
      original_filename: parsed.data.originalFilename ?? null,
      width: parsed.data.width ?? null,
      height: parsed.data.height ?? null,
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
