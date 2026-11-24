import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStudioUser } from '@/lib/studio/supabase-server';
import { studioFileUrl } from '@/lib/studio/storage';
import { DEFAULT_EDIT_MODEL } from '@/lib/studio/models';
import type { GenerationRow } from '@/lib/studio/types';

const bodySchema = z.object({
  sourceType: z.enum(['generation', 'packshot']),
  sourceId: z.string().uuid(),
  /** Ścieżka PNG wyrenderowanego w przeglądarce (bucket generations, {uid}/…). */
  path: z.string().min(1).max(500),
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
  /** Opis suwaków — trafia do edit_instruction (czysta informacja dla UI). */
  description: z.string().trim().min(1).max(500),
});

/**
 * Rejestracja korekt kolorystycznych (zakładka Edycja → Korekty).
 * Obraz renderuje się W PRZEGLĄDARCE (canvas) i idzie prosto do Storage —
 * tu tylko walidujemy ścieżkę i dopisujemy nową, od razu ukończoną wersję
 * do drzewa (bez wywołań modeli AI).
 */
export async function POST(request: NextRequest) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe dane korekty.' }, { status: 400 });
  }
  const input = parsed.data;

  if (
    !input.path.startsWith(`${auth.user.id}/`) ||
    input.path.includes('..') ||
    !input.path.endsWith('.png')
  ) {
    return NextResponse.json({ error: 'Nieprawidłowa ścieżka pliku.' }, { status: 400 });
  }
  const exists = await auth.supabase.storage.from('generations').createSignedUrl(input.path, 60);
  if (exists.error) {
    return NextResponse.json(
      { error: 'Nie znaleziono wyrenderowanego pliku w Storage — spróbuj ponownie.' },
      { status: 400 }
    );
  }

  // Kontekst dziedziczony od źródła — jak przy edycji pędzlem.
  let parentGenerationId: string | null = null;
  let packshotId: string | null = null;
  let roomId: string | null = null;
  let model: string = DEFAULT_EDIT_MODEL;
  let inheritedShared = false;

  if (input.sourceType === 'generation') {
    const { data: parent } = await auth.supabase
      .from('generations')
      .select('id, packshot_id, room_id, model, shared, status, storage_path')
      .eq('id', input.sourceId)
      .maybeSingle();
    if (!parent || parent.status !== 'done' || !parent.storage_path) {
      return NextResponse.json(
        { error: 'Źródłowa wizualizacja nie istnieje albo nie jest ukończona.' },
        { status: 400 }
      );
    }
    parentGenerationId = parent.id;
    packshotId = parent.packshot_id;
    roomId = parent.room_id;
    model = parent.model;
    inheritedShared = parent.shared;
  } else {
    const { data: pk } = await auth.supabase
      .from('packshots')
      .select('id, shared')
      .eq('id', input.sourceId)
      .maybeSingle();
    if (!pk) {
      return NextResponse.json({ error: 'Nie znaleziono packshota.' }, { status: 400 });
    }
    packshotId = pk.id;
    inheritedShared = pk.shared;
  }

  const { data: created, error: insErr } = await auth.supabase
    .from('generations')
    .insert({
      user_id: auth.user.id,
      packshot_id: packshotId,
      parent_generation_id: parentGenerationId,
      room_id: roomId,
      model,
      edit_instruction: input.description,
      storage_path: input.path,
      width: input.width ?? null,
      height: input.height ?? null,
      status: 'done',
      shared: inheritedShared,
    })
    .select()
    .single();

  if (insErr || !created) {
    return NextResponse.json(
      { error: `Nie udało się zapisać korekty: ${insErr?.message}` },
      { status: 500 }
    );
  }
  const generation = created as GenerationRow;

  return NextResponse.json({
    generation: {
      ...generation,
      image_url: studioFileUrl('generations', input.path),
    },
  });
}
