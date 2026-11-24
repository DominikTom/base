import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStudioUser } from '@/lib/studio/supabase-server';
import { studioFileUrl } from '@/lib/studio/storage';
import type { GenerationRow } from '@/lib/studio/types';

const bodySchema = z.object({
  /** Ścieżka pliku wgranego z przeglądarki do bucketu generations ({uid}/upload-…). */
  path: z.string().min(1).max(500),
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
});

/**
 * Rejestracja własnego zdjęcia spoza narzędzia (zakładka Edycja → „Wgraj
 * zdjęcie"). Plik idzie z przeglądarki prosto do Storage; tu dopisujemy
 * gotowy wiersz (model='upload', status 'done'), dzięki czemu całe
 * istniejące API edycji — maska, gumka, korekty, drzewo wersji — działa
 * na nim bez żadnych zmian.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe dane zdjęcia.' }, { status: 400 });
  }
  const { path } = parsed.data;

  if (
    !path.startsWith(`${auth.user.id}/upload-`) ||
    path.includes('..') ||
    !/\.(png|jpg|jpeg|webp)$/i.test(path)
  ) {
    return NextResponse.json({ error: 'Nieprawidłowa ścieżka pliku.' }, { status: 400 });
  }
  const exists = await auth.supabase.storage.from('generations').createSignedUrl(path, 60);
  if (exists.error) {
    return NextResponse.json(
      { error: 'Nie znaleziono pliku w Storage — spróbuj wgrać ponownie.' },
      { status: 400 }
    );
  }

  const { data, error } = await auth.supabase
    .from('generations')
    .insert({
      user_id: auth.user.id,
      model: 'upload',
      status: 'done',
      storage_path: path,
      width: parsed.data.width ?? null,
      height: parsed.data.height ?? null,
      shared: false,
    })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: `Nie udało się zapisać zdjęcia: ${error?.message}` },
      { status: 500 }
    );
  }
  const generation = data as GenerationRow;

  return NextResponse.json({
    generation: { ...generation, image_url: studioFileUrl('generations', path) },
  });
}
