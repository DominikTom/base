import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { purgeGeneration, purgeInspirationSet, purgePackshot } from '@/lib/studio/purge';
import { requireStudioUser } from '@/lib/studio/supabase-server';
import { studioFileUrl } from '@/lib/studio/storage';
import type { GenerationRow, InspirationSetRow, PackshotRow } from '@/lib/studio/types';

export async function GET() {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const [generations, packshots, sets] = await Promise.all([
    auth.supabase
      .from('generations')
      .select('*')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false }),
    auth.supabase
      .from('packshots')
      .select('*')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false }),
    auth.supabase
      .from('inspiration_sets')
      .select('*')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false }),
  ]);

  return NextResponse.json({
    generations: ((generations.data ?? []) as GenerationRow[]).map((g) => ({
      ...g,
      image_url: g.storage_path ? studioFileUrl('generations', g.storage_path) : null,
    })),
    packshots: ((packshots.data ?? []) as PackshotRow[]).map((p) => ({
      ...p,
      image_url: studioFileUrl('packshots', p.storage_path),
    })),
    sets: (sets.data ?? []) as InspirationSetRow[],
  });
}

const actionSchema = z.object({
  type: z.enum(['generation', 'packshot', 'inspiration_set']),
  id: z.string().uuid(),
});

const TABLE_FOR_TYPE = {
  generation: 'generations',
  packshot: 'packshots',
  inspiration_set: 'inspiration_sets',
} as const;

/** Przywracanie z kosza. */
export async function POST(request: NextRequest) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania.' }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from(TABLE_FOR_TYPE[parsed.data.type])
    .update({ deleted_at: null })
    .eq('id', parsed.data.id);
  if (error) {
    return NextResponse.json({ error: `Przywracanie nie powiodło się: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** Trwałe usunięcie pojedynczego elementu (wraz z plikami ze Storage). */
export async function DELETE(request: NextRequest) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania.' }, { status: 400 });
  }
  const { type, id } = parsed.data;

  try {
    if (type === 'generation') await purgeGeneration(auth.supabase, id);
    if (type === 'packshot') await purgePackshot(auth.supabase, id);
    if (type === 'inspiration_set') await purgeInspirationSet(auth.supabase, id);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Usuwanie nie powiodło się.' },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
