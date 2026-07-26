import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStudioUser } from '@/lib/studio/supabase-server';
import { studioFileUrl } from '@/lib/studio/storage';
import type { InspirationImageRow, InspirationSetRow } from '@/lib/studio/types';

export async function GET() {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await auth.supabase
    .from('inspiration_sets')
    .select('*, rooms(name)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: `Nie udało się pobrać zestawów: ${error.message}` }, { status: 500 });
  }

  type Row = InspirationSetRow & { rooms: { name: string } | null };
  const sets = (data ?? []) as Row[];

  const setIds = sets.map((s) => s.id);
  const { data: images } = setIds.length
    ? await auth.supabase
        .from('inspiration_images')
        .select('id, set_id, storage_path')
        .in('set_id', setIds)
    : { data: [] };
  const imagesBySet = new Map<string, { id: string; storage_path: string }[]>();
  for (const img of (images ?? []) as InspirationImageRow[]) {
    const list = imagesBySet.get(img.set_id) ?? [];
    list.push(img);
    imagesBySet.set(img.set_id, list);
  }

  return NextResponse.json({
    sets: sets.map(({ rooms, ...s }) => {
      const imgs = imagesBySet.get(s.id) ?? [];
      const cover = imgs.find((i) => i.id === s.cover_image_id) ?? imgs[0];
      return {
        ...s,
        room_name: rooms?.name ?? null,
        image_count: imgs.length,
        cover_url: cover ? studioFileUrl('inspirations', cover.storage_path) : null,
      };
    }),
  });
}

const createSchema = z.object({
  name: z.string().min(1, 'Podaj nazwę zestawu.').max(200),
  description: z.string().max(1000).optional(),
  roomId: z.string().uuid().nullish(),
});

export async function POST(request: NextRequest) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' },
      { status: 400 }
    );
  }

  const { data, error } = await auth.supabase
    .from('inspiration_sets')
    .insert({
      user_id: auth.user.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      room_id: parsed.data.roomId ?? null,
    })
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: `Nie udało się utworzyć zestawu: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ set: data });
}
