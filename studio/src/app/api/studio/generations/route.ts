import { after, NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isStudioModelId } from '@/lib/studio/models';
import { buildGenerationPrompt } from '@/lib/studio/prompts';
import { runGeneration } from '@/lib/studio/run-generation';
import { requireStudioUser } from '@/lib/studio/supabase-server';
import { studioFileUrl } from '@/lib/studio/storage';
import type { GenerationRow } from '@/lib/studio/types';

/** Generacja potrafi trwać kilka minut (modele obrazowe + upload wyniku). */
export const maxDuration = 300;

const packshotEntry = z.object({
  id: z.string().uuid(),
  role: z.enum(['main', 'addition']).default('main'),
});

const createSchema = z.object({
  /** Stary format (pojedynczy packshot) — nadal wspierany. */
  packshotId: z.string().uuid().optional(),
  /** Nowy format: 1–5 packshotów z rolami; min. jeden główny. */
  packshots: z.array(packshotEntry).min(1).max(5).optional(),
  roomId: z.string().uuid(),
  styleText: z.string().max(2000).optional(),
  inspirationSetId: z.string().uuid().nullish(),
  inspirationStrength: z.number().int().min(1).max(5).nullish(),
  manualNotes: z.string().max(2000).optional(),
  model: z.string().refine(isStudioModelId, 'Nieznany model generacji.'),
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
  const additions = packshotList.filter((p) => p.role === 'addition');

  const { count: foundPackshots } = await auth.supabase
    .from('packshots')
    .select('id', { count: 'exact', head: true })
    .in('id', [...uniqueIds])
    .is('deleted_at', null);
  if ((foundPackshots ?? 0) !== uniqueIds.size) {
    return NextResponse.json({ error: 'Któryś z packshotów nie istnieje albo jest w koszu.' }, { status: 400 });
  }

  const { data: room, error: roomErr } = await auth.supabase
    .from('rooms')
    .select('id, name, base_prompt')
    .eq('id', input.roomId)
    .single();
  if (roomErr || !room) {
    return NextResponse.json({ error: 'Nie znaleziono wybranego pokoju.' }, { status: 400 });
  }

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
  const fullPrompt = buildGenerationPrompt({
    roomName: room.name,
    roomBasePrompt: room.base_prompt,
    styleText: input.styleText,
    inspirationStrength: strength,
    inspirationImageCount,
    manualNotes: input.manualNotes,
    mainCount: mains.length,
    additionCount: additions.length,
  });

  const { data: created, error: insErr } = await auth.supabase
    .from('generations')
    .insert({
      user_id: auth.user.id,
      packshot_id: mains[0].id,
      room_id: input.roomId,
      style_text: input.styleText ?? null,
      inspiration_set_id: input.inspirationSetId ?? null,
      inspiration_strength: hasInspirationImages ? strength : null,
      manual_notes: input.manualNotes ?? null,
      model: input.model,
      full_prompt_sent: fullPrompt,
      status: 'pending',
    })
    .select()
    .single();
  if (insErr || !created) {
    return NextResponse.json(
      { error: `Nie udało się utworzyć generacji: ${insErr?.message}` },
      { status: 500 }
    );
  }

  // Powiązania packshotów z rolami (główne najpierw, kolejność wg wyboru).
  const orderedForInsert = [...mains, ...additions];
  const { error: linkErr } = await auth.supabase.from('generation_packshots').insert(
    orderedForInsert.map((p, i) => ({
      generation_id: (created as GenerationRow).id,
      packshot_id: p.id,
      role: p.role,
      sort_order: i,
    }))
  );
  if (linkErr) {
    await auth.supabase.from('generations').delete().eq('id', (created as GenerationRow).id);
    return NextResponse.json(
      { error: `Nie udało się zapisać packshotów generacji: ${linkErr.message}` },
      { status: 500 }
    );
  }

  if (input.async) {
    // Odpowiadamy od razu rekordem "pending", a generacja dokańcza się po
    // wysłaniu odpowiedzi (after + maxDuration 300) — user może wyjść z ekranu,
    // klient polluje GET /generations/[id].
    after(async () => {
      await runGeneration(auth.supabase, created as GenerationRow);
    });
    return NextResponse.json({ generation: { ...(created as GenerationRow), image_url: null } });
  }

  const finished = await runGeneration(auth.supabase, created as GenerationRow);
  return NextResponse.json({
    generation: {
      ...finished,
      image_url: finished.storage_path ? studioFileUrl('generations', finished.storage_path) : null,
    },
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
