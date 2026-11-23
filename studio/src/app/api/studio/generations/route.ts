import { after, NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isStudioModelId, type StudioModelId } from '@/lib/studio/models';
import { buildGenerationPrompt } from '@/lib/studio/prompts';
import { runGeneration } from '@/lib/studio/run-generation';
import { requireStudioUser } from '@/lib/studio/supabase-server';
import { studioFileUrl } from '@/lib/studio/storage';
import { MAX_BATCH_TOTAL, type GenerationRow } from '@/lib/studio/types';

/** Generacja potrafi trwać kilka minut (modele obrazowe + upload wyniku). */
export const maxDuration = 300;

const packshotEntry = z.object({
  id: z.string().uuid(),
  role: z.enum(['main', 'variant', 'addition']).default('main'),
  /** "Gdzie ustawić, co na nim położyć" — trafia do promptu przy tym obrazie. */
  note: z.string().max(500).optional(),
});

const createSchema = z.object({
  /** Stary format (pojedynczy packshot) — nadal wspierany. */
  packshotId: z.string().uuid().optional(),
  /** Nowy format: 1–5 packshotów z rolami; min. jeden główny. */
  packshots: z.array(packshotEntry).min(1).max(5).optional(),
  /** Jeden pokój (stary format) albo lista pokoi — seria pokój × model × wariant. */
  roomId: z.string().uuid().optional(),
  roomIds: z.array(z.string().uuid()).min(1).max(4).optional(),
  styleText: z.string().max(2000).optional(),
  inspirationSetId: z.string().uuid().nullish(),
  inspirationStrength: z.number().int().min(1).max(5).nullish(),
  manualNotes: z.string().max(2000).optional(),
  aspectRatio: z.enum(['1:1', '3:4', '9:16', '4:3', '16:9']).default('4:3'),
  cameraShot: z.enum(['auto', 'wide', 'medium', 'close']).default('auto'),
  cameraAngle: z
    .enum(['auto', 'front', 'three-quarter-left', 'three-quarter-right', 'side', 'low', 'elevated'])
    .default('auto'),
  lighting: z
    .enum(['auto', 'morning', 'daylight-soft', 'golden', 'evening', 'studio'])
    .default('auto'),
  /** Rozdzielczość (sens dla Nano Banana Pro: 2K standard, 4K finalne). */
  imageSize: z.enum(['2K', '4K']).optional(),
  model: z.string().refine(isStudioModelId, 'Nieznany model generacji.').optional(),
  models: z
    .array(z.string().refine(isStudioModelId, 'Nieznany model generacji.'))
    .min(1)
    .max(3)
    .optional(),
  /** Liczba wariantów na kombinację pokój × model. */
  variants: z.number().int().min(1).max(4).default(1),
  /** Wysyłka bez czekania na wynik — klient sam polluje status. */
  async: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Nieprawidłowe dane: ${parsed.error.issues[0]?.message ?? 'sprawdź formularz'}` },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // Normalizacja packshotów: nowy format (lista z rolami) albo stary (pojedynczy).
  let packshotList = input.packshots ?? (input.packshotId ? [{ id: input.packshotId, role: 'main' as const }] : []);
  if (packshotList.length === 0) {
    return NextResponse.json({ error: 'Wybierz przynajmniej jeden packshot.' }, { status: 400 });
  }
  const uniqueIds = new Set(packshotList.map((p) => p.id));
  if (uniqueIds.size !== packshotList.length) {
    return NextResponse.json({ error: 'Packshoty nie mogą się powtarzać.' }, { status: 400 });
  }
  if (!packshotList.some((p) => p.role === 'main')) {
    // Automatyczne wykrycie: bez jawnie głównego — pierwszy zostaje głównym.
    packshotList = packshotList.map((p, i) => (i === 0 ? { ...p, role: 'main' as const } : p));
  }
  const mains = packshotList.filter((p) => p.role === 'main');
  const variantsOfMain = packshotList.filter((p) => p.role === 'variant');
  const additions = packshotList.filter((p) => p.role === 'addition');
  /** Kolejność obrazów dla modelu i zapisu: główne → warianty → dodatki. */
  const orderedPackshots = [...mains, ...variantsOfMain, ...additions];

  const { count: foundPackshots } = await auth.supabase
    .from('packshots')
    .select('id', { count: 'exact', head: true })
    .in('id', [...uniqueIds])
    .is('deleted_at', null);
  if ((foundPackshots ?? 0) !== uniqueIds.size) {
    return NextResponse.json({ error: 'Któryś z packshotów nie istnieje albo jest w koszu.' }, { status: 400 });
  }

  // Seria: pokoje × modele × warianty (z twardym limitem łącznym).
  const roomIds = input.roomIds ?? (input.roomId ? [input.roomId] : []);
  const models = (input.models ?? (input.model ? [input.model] : [])) as StudioModelId[];
  if (roomIds.length === 0) {
    return NextResponse.json({ error: 'Wybierz przynajmniej jeden pokój.' }, { status: 400 });
  }
  if (models.length === 0) {
    return NextResponse.json({ error: 'Wybierz przynajmniej jeden model.' }, { status: 400 });
  }
  const total = roomIds.length * models.length * input.variants;
  if (total > MAX_BATCH_TOTAL) {
    return NextResponse.json(
      { error: `Seria ma ${total} generacji — maksimum to ${MAX_BATCH_TOTAL}. Zmniejsz liczbę pokoi, modeli lub wariantów.` },
      { status: 400 }
    );
  }

  const { data: rooms, error: roomErr } = await auth.supabase
    .from('rooms')
    .select('id, name, base_prompt')
    .in('id', [...new Set(roomIds)]);
  if (roomErr || !rooms || rooms.length !== new Set(roomIds).size) {
    return NextResponse.json({ error: 'Nie znaleziono któregoś z wybranych pokoi.' }, { status: 400 });
  }
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  let inspirationImageCount = 0;
  if (input.inspirationSetId) {
    const { count } = await auth.supabase
      .from('inspiration_images')
      .select('id', { count: 'exact', head: true })
      .eq('set_id', input.inspirationSetId);
    inspirationImageCount = count ?? 0;
  }
  const hasInspirationImages = inspirationImageCount > 0;

  const strength = input.inspirationSetId ? (input.inspirationStrength ?? 3) : null;

  // Wiersze serii: jeden na kombinację pokój × model × wariant.
  const batchId = total > 1 ? randomUUID() : null;
  const rowsToInsert: Record<string, unknown>[] = [];
  for (const roomId of roomIds) {
    const room = roomById.get(roomId)!;
    const fullPrompt = buildGenerationPrompt({
      roomName: room.name,
      roomBasePrompt: room.base_prompt,
      styleText: input.styleText,
      inspirationStrength: strength,
      inspirationImageCount,
      manualNotes: input.manualNotes,
      mainCount: mains.length,
      variantCount: variantsOfMain.length,
      additionCount: additions.length,
      packshotNotes: orderedPackshots.map((p) => p.note ?? null),
      aspectRatio: input.aspectRatio,
      cameraShot: input.cameraShot === 'auto' ? null : input.cameraShot,
      cameraAngle: input.cameraAngle === 'auto' ? null : input.cameraAngle,
      lighting: input.lighting === 'auto' ? null : input.lighting,
    });
    for (const model of models) {
      for (let v = 0; v < input.variants; v++) {
        rowsToInsert.push({
          user_id: auth.user.id,
          packshot_id: mains[0].id,
          room_id: roomId,
          style_text: input.styleText ?? null,
          inspiration_set_id: input.inspirationSetId ?? null,
          inspiration_strength: hasInspirationImages ? strength : null,
          manual_notes: input.manualNotes ?? null,
          aspect_ratio: input.aspectRatio,
          camera_shot: input.cameraShot === 'auto' ? null : input.cameraShot,
          camera_angle: input.cameraAngle === 'auto' ? null : input.cameraAngle,
          lighting: input.lighting === 'auto' ? null : input.lighting,
          image_size: model === 'nano-banana-pro' ? (input.imageSize ?? null) : null,
          batch_id: batchId,
          model,
          full_prompt_sent: fullPrompt,
          status: 'pending',
        });
      }
    }
  }

  const { data: createdRows, error: insErr } = await auth.supabase
    .from('generations')
    .insert(rowsToInsert)
    .select();
  if (insErr || !createdRows || createdRows.length === 0) {
    return NextResponse.json(
      { error: `Nie udało się utworzyć generacji: ${insErr?.message}` },
      { status: 500 }
    );
  }
  const created = createdRows as GenerationRow[];

  // Powiązania packshotów z rolami (główne → warianty → dodatki).
  const orderedForInsert = orderedPackshots;
  const { error: linkErr } = await auth.supabase.from('generation_packshots').insert(
    created.flatMap((g) =>
      orderedForInsert.map((p, i) => ({
        generation_id: g.id,
        packshot_id: p.id,
        role: p.role,
        note: p.note?.trim() || null,
        sort_order: i,
      }))
    )
  );
  if (linkErr) {
    await auth.supabase.from('generations').delete().in('id', created.map((g) => g.id));
    return NextResponse.json(
      { error: `Nie udało się zapisać packshotów generacji: ${linkErr.message}` },
      { status: 500 }
    );
  }

  /** Seria wykonuje się z ograniczoną współbieżnością (limity API modeli). */
  const runAll = async () => {
    const queue = [...created];
    const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
      for (let g = queue.shift(); g; g = queue.shift()) {
        await runGeneration(auth.supabase, g);
      }
    });
    await Promise.all(workers);
  };

  if (input.async) {
    // Odpowiadamy od razu rekordami "pending", a seria dokańcza się po wysłaniu
    // odpowiedzi (after + maxDuration 300) — user może wyjść z ekranu.
    after(runAll);
    return NextResponse.json({
      generation: { ...created[0], image_url: null },
      batchId,
      generationIds: created.map((g) => g.id),
    });
  }

  await runAll();
  const { data: finishedFirst } = await auth.supabase
    .from('generations')
    .select('*')
    .eq('id', created[0].id)
    .single();
  const finished = (finishedFirst as GenerationRow) ?? created[0];
  return NextResponse.json({
    generation: {
      ...finished,
      image_url: finished.storage_path ? studioFileUrl('generations', finished.storage_path) : null,
    },
    batchId,
    generationIds: created.map((g) => g.id),
  });
}

export async function GET(request: NextRequest) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const q = request.nextUrl.searchParams;
  let query = auth.supabase
    .from('generations')
    .select('*, rooms(name), inspiration_sets(name)')
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(q.get('limit') ?? 100), 200));

  if (q.get('deleted') === '1') {
    query = query.not('deleted_at', 'is', null);
  } else {
    query = query.is('deleted_at', null);
  }
  if (q.get('room')) query = query.eq('room_id', q.get('room'));
  if (q.get('model')) query = query.eq('model', q.get('model'));
  if (q.get('set')) query = query.eq('inspiration_set_id', q.get('set'));
  if (q.get('author')) query = query.eq('user_id', q.get('author'));
  if (q.get('status')) query = query.eq('status', q.get('status'));
  if (q.get('packshot')) query = query.eq('packshot_id', q.get('packshot'));
  if (q.get('batch')) query = query.eq('batch_id', q.get('batch'));
  if (q.get('fav') === '1') query = query.eq('is_favorite', true);
  const search = q.get('q')?.trim();
  if (search) {
    const term = `%${search.replaceAll('%', '\\%')}%`;
    query = query.or(
      `manual_notes.ilike.${term},style_text.ilike.${term},full_prompt_sent.ilike.${term},edit_instruction.ilike.${term}`
    );
  }
  const from = q.get('from');
  if (from) query = query.gte('created_at', from);
  const to = q.get('to');
  if (to) query = query.lte('created_at', to);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: `Nie udało się pobrać biblioteki: ${error.message}` }, { status: 500 });
  }

  type Row = GenerationRow & {
    rooms: { name: string } | null;
    inspiration_sets: { name: string } | null;
  };
  const rows = (data ?? []) as Row[];

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: profiles } = userIds.length
    ? await auth.supabase.from('profiles').select('id, display_name').in('id', userIds)
    : { data: [] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const generations = rows.map(({ rooms, inspiration_sets, ...row }) => ({
    ...row,
    image_url: row.storage_path ? studioFileUrl('generations', row.storage_path) : null,
    room_name: rooms?.name ?? null,
    set_name: inspiration_sets?.name ?? null,
    author_name: nameById.get(row.user_id) ?? null,
  }));

  return NextResponse.json({ generations });
}
