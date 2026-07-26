import { after, NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { DEFAULT_EDIT_MODEL, isStudioModelId } from '@/lib/studio/models';
import { annotatedPathForMask, runGeneration } from '@/lib/studio/run-generation';
import { requireStudioUser } from '@/lib/studio/supabase-server';
import { studioFileUrl, uploadToBucket } from '@/lib/studio/storage';
import type { GenerationRow } from '@/lib/studio/types';

export const maxDuration = 300;

/** Maski/annotacje 4K potrafią być duże, ale trzymamy rozsądny limit. */
const MAX_MASK_BYTES = 40 * 1024 * 1024;

const fieldsSchema = z.object({
  sourceType: z.enum(['generation', 'packshot']),
  sourceId: z.string().uuid(),
  instruction: z.string().min(1, 'Opisz, co zmienić w zaznaczonym obszarze.').max(2000),
  model: z.string().refine(isStudioModelId, 'Nieznany model.').default(DEFAULT_EDIT_MODEL),
});

/**
 * Edycja pędzlem: przyjmuje maskę (PNG, przezroczysty obszar = do edycji)
 * oraz annotowaną kopię (czerwona półprzezroczysta maska) i tworzy NOWĄ WERSJĘ
 * podpiętą do rodzica (drzewo wersji).
 */
export async function POST(request: NextRequest) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Oczekiwano multipart/form-data.' }, { status: 400 });
  }

  const parsed = fieldsSchema.safeParse({
    sourceType: form.get('sourceType'),
    sourceId: form.get('sourceId'),
    instruction: form.get('instruction'),
    model: form.get('model') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const mask = form.get('mask');
  const annotated = form.get('annotated');
  if (!(mask instanceof File) || !(annotated instanceof File)) {
    return NextResponse.json({ error: 'Brak maski lub annotowanej kopii obrazu.' }, { status: 400 });
  }
  if (mask.size > MAX_MASK_BYTES || annotated.size > MAX_MASK_BYTES) {
    return NextResponse.json({ error: 'Maska jest za duża.' }, { status: 400 });
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
      edit_instruction: input.instruction,
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

  const maskPath = `masks/${auth.user.id}/${generation.id}-mask.png`;
  try {
    await uploadToBucket(
      auth.supabase,
      'generations',
      maskPath,
      Buffer.from(await mask.arrayBuffer()),
      'image/png'
    );
    await uploadToBucket(
      auth.supabase,
      'generations',
      annotatedPathForMask(maskPath),
      Buffer.from(await annotated.arrayBuffer()),
      'image/png'
    );
  } catch (err) {
    await auth.supabase
      .from('generations')
      .update({ status: 'error', error_message: `Upload maski nie powiódł się: ${String(err)}` })
      .eq('id', generation.id);
    return NextResponse.json({ error: 'Upload maski nie powiódł się.' }, { status: 500 });
  }

  await auth.supabase
    .from('generations')
    .update({ mask_storage_path: maskPath })
    .eq('id', generation.id);

  const pendingRow = { ...generation, mask_storage_path: maskPath };

  if (form.get('async') === '1') {
    after(async () => {
      await runGeneration(auth.supabase, pendingRow);
    });
    return NextResponse.json({ generation: { ...pendingRow, image_url: null } });
  }

  const finished = await runGeneration(auth.supabase, pendingRow);
  return NextResponse.json({
    generation: {
      ...finished,
      image_url: finished.storage_path ? studioFileUrl('generations', finished.storage_path) : null,
    },
  });
}
