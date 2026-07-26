import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStudioUser } from '@/lib/studio/supabase-server';
import { studioFileUrl } from '@/lib/studio/storage';
import type { InspirationImageRow, InspirationSetRow } from '@/lib/studio/types';

type Ctx = RouteContext<'/api/studio/inspirations/[id]'>;

export async function GET(_request: NextRequest, ctx: Ctx) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;

  const { data: set, error } = await auth.supabase
    .from('inspiration_sets')
    .select('*, rooms(name)')
    .eq('id', id)
    .single();
  if (error || !set) {
    return NextResponse.json({ error: 'Nie znaleziono zestawu.' }, { status: 404 });
  }

  const { data: images } = await auth.supabase
    .from('inspiration_images')
    .select('*')
    .eq('set_id', id)
    .order('created_at', { ascending: true });

  type Row = InspirationSetRow & { rooms: { name: string } | null };
  const { rooms, ...s } = set as Row;

  return NextResponse.json({
    set: { ...s, room_name: rooms?.name ?? null },
    images: ((images ?? []) as InspirationImageRow[]).map((img) => ({
      ...img,
      image_url: studioFileUrl('inspirations', img.storage_path),
    })),
  });
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullish(),
  roomId: z.string().uuid().nullish(),
  coverImageId: z.string().uuid().nullish(),
  action: z.enum(['trash', 'restore']).optional(),
});

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania.' }, { status: 400 });
  }
  const input = parsed.data;

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.description !== undefined) update.description = input.description;
  if (input.roomId !== undefined) update.room_id = input.roomId;
  if (input.coverImageId !== undefined) update.cover_image_id = input.coverImageId;
  if (input.action) update.deleted_at = input.action === 'trash' ? new Date().toISOString() : null;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Brak zmian do zapisania.' }, { status: 400 });
  }

  const { error } = await auth.supabase.from('inspiration_sets').update(update).eq('id', id);
  if (error) {
    return NextResponse.json({ error: `Operacja nie powiodła się: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
