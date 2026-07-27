import { after, NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { DEFAULT_EDIT_MODEL, isStudioModelId } from '@/lib/studio/models';
import { annotatedPathForMask, runGeneration } from '@/lib/studio/run-generation';
import { requireStudioUser } from '@/lib/studio/supabase-server';
import { studioFileUrl } from '@/lib/studio/storage';
import type { GenerationRow } from '@/lib/studio/types';

export const maxDuration = 300;

const bodySchema = z.object({
  sourceType: z.enum(['generation', 'packshot']),
  sourceId: z.string().uuid(),
  instruction: z.string().max(2000).optional(),
  model: z.string().refine(isStudioModelId, 'Nieznany model.').default(DEFAULT_EDIT_MODEL),
  /**
   * Ścieżka maski w buckecie `generations` (wgranej z przeglądarki prosto do
   * Storage — omija limit 4,5 MB body Vercela). Annotowana kopia leży pod
   * ścieżką pochodną (-annotated.png).
   */
  maskPath: z.string().min(1).max(500),
  /**
   * Obrazy referencyjne produktów do wstawienia w zaznaczony obszar
   * (wgrane client-side do bucketu `generations` pod edit-refs/{userId}/).
   */
  referencePaths: z.array(z.string().min(1).max(500)).max(4).optional(),
  async: z.boolean().optional(),
});

/**
 * Edycja pędzlem: maska (PNG, przezroczysty obszar = do edycji) i annotowana
 * kopia są już w Storage; tworzymy NOWĄ WERSJĘ podpiętą do rodzica.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const referencePaths = input.referencePaths ?? [];

  const instruction =
    input.instruction?.trim() ||
    (referencePaths.length > 0
      ? 'Wstaw produkt(y) z załączonych obrazów referencyjnych w zaznaczonym obszarze.'
      : null);
  if (!instruction) {
    return NextResponse.json(
      { error: 'Opisz, co zmienić w zaznaczonym obszarze, albo dodaj obrazy referencyjne.' },
      { status: 400 }
    );
  }

  // Maska musi leżeć w katalogu masek tego użytkownika.
  if (
    !input.maskPath.startsWith(`masks/${auth.user.id}/`) ||
    !input.maskPath.endsWith('-mask.png') ||
    input.maskPath.includes('..')
  ) {
    return NextResponse.json({ error: 'Nieprawidłowa ścieżka maski.' }, { status: 400 });
  }
  for (const refPath of referencePaths) {
    if (
      !refPath.startsWith(`edit-refs/${auth.user.id}/`) ||
      refPath.includes('..') ||
      !/\.(png|jpg|jpeg|webp)$/i.test(refPath)
    ) {
      return NextResponse.json({ error: 'Nieprawidłowa ścieżka obrazu referencyjnego.' }, { status: 400 });
    }
  }

  // Szybka weryfikacja, że pliki faktycznie są w Storage.
  const checks = await Promise.all([
    auth.supabase.storage.from('generations').createSignedUrl(input.maskPath, 60),
    auth.supabase.storage
      .from('generations')
      .createSignedUrl(annotatedPathForMask(input.maskPath), 60),
    ...referencePaths.map((p) =>
      auth.supabase.storage.from('generations').createSignedUrl(p, 60)
    ),
  ]);
  if (checks.some((c) => c.error)) {
    return NextResponse.json(
      { error: 'Nie znaleziono maski lub referencji w Storage — spróbuj ponownie.' },
      { status: 400 }
    );
  }

  // Źródło edycji + kontekst dziedziczony do drzewa wersji
  let parentGenerationId: string | null = null;
  let packshotId: string | null = null;
  let roomId: string | null = null;
  let inheritedShared = true;

  if (input.sourceType === 'generation') {
    const { data: parent } = await auth.supabase
      .from('generations')
      .select('id, packshot_id, room_id, shared, status, storage_path')
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
      model: input.model,
      edit_instruction: instruction,
      edit_reference_paths: referencePaths.length > 0 ? referencePaths : null,
      mask_storage_path: input.maskPath,
      shared: inheritedShared,
      status: 'pending',
    })
    .select()
    .single();
  if (insErr || !created) {
    return NextResponse.json(
      { error: `Nie udało się utworzyć edycji: ${insErr?.message}` },
      { status: 500 }
    );
  }
  const generation = created as GenerationRow;

  if (input.async) {
    after(async () => {
      await runGeneration(auth.supabase, generation);
    });
    return NextResponse.json({ generation: { ...generation, image_url: null } });
  }

  const finished = await runGeneration(auth.supabase, generation);
  return NextResponse.json({
    generation: {
      ...finished,
      image_url: finished.storage_path ? studioFileUrl('generations', finished.storage_path) : null,
    },
  });
}
