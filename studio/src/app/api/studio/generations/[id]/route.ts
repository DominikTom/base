import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStudioUser } from '@/lib/studio/supabase-server';
import { studioFileUrl } from '@/lib/studio/storage';
import type { GenerationRow } from '@/lib/studio/types';

type Ctx = RouteContext<'/api/studio/generations/[id]'>;

export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;

  const { data, error } = await auth.supabase
    .from('generations')
    .select('*, rooms(name), inspiration_sets(name)')
    .eq('id', id)
    .single();
  if (error || !data) {
    return NextResponse.json({ error: 'Nie znaleziono wizualizacji.' }, { status: 404 });
  }

  type Row = GenerationRow & {
    rooms: { name: string } | null;
    inspiration_sets: { name: string } | null;
  };
  const { rooms, inspiration_sets, ...row } = data as Row;

  // Packshoty źródłowe (1–5, z rolami; fallback do pojedynczego packshot_id)
  const { data: links } = await auth.supabase
    .from('generation_packshots')
    .select('packshot_id, role, sort_order')
    .eq('generation_id', row.id);
  const orderedLinks =
    links && links.length > 0
      ? [...links].sort((a, b) =>
          a.role === b.role ? a.sort_order - b.sort_order : a.role === 'main' ? -1 : 1
        )
      : row.packshot_id
        ? [{ packshot_id: row.packshot_id, role: 'main', sort_order: 0 }]
        : [];

  let packshots: {
    id: string;
    role: string;
    image_url: string;
    original_filename: string | null;
  }[] = [];
  if (orderedLinks.length > 0) {
    const { data: pks } = await auth.supabase
      .from('packshots')
      .select('id, storage_path, original_filename')
      .in('id', orderedLinks.map((l) => l.packshot_id));
    const byId = new Map((pks ?? []).map((p) => [p.id, p]));
    packshots = orderedLinks.flatMap((l) => {
      const pk = byId.get(l.packshot_id);
      return pk
        ? [{
            id: pk.id,
            role: l.role,
            image_url: studioFileUrl('packshots', pk.storage_path),
            original_filename: pk.original_filename,
          }]
        : [];
    });
  }
  const packshot = packshots[0] ?? null;

  // Drzewo wersji: korzeń → wszyscy potomkowie (edycje pędzlem jako dzieci).
  let rootId = row.id;
  let cursor: GenerationRow = row;
  for (let i = 0; i < 20 && cursor.parent_generation_id; i++) {
    const { data: parent } = await auth.supabase
      .from('generations')
      .select('*')
      .eq('id', cursor.parent_generation_id)
      .maybeSingle();
    if (!parent) break;
    cursor = parent as GenerationRow;
    rootId = cursor.id;
  }

  const tree: GenerationRow[] = [cursor];
  let frontier = [rootId];
  for (let depth = 0; depth < 10 && frontier.length > 0; depth++) {
    const { data: children } = await auth.supabase
      .from('generations')
      .select('*')
      .in('parent_generation_id', frontier)
      .order('created_at', { ascending: true });
    const rows = (children ?? []) as GenerationRow[];
    if (rows.length === 0) break;
    tree.push(...rows);
    frontier = rows.map((r) => r.id);
  }

  const author = await auth.supabase
    .from('profiles')
    .select('display_name')
    .eq('id', row.user_id)
    .maybeSingle();

  const withUrl = (g: GenerationRow) => ({
    ...g,
    image_url: g.storage_path ? studioFileUrl('generations', g.storage_path) : null,
  });

  return NextResponse.json({
    generation: {
      ...withUrl(row),
      room_name: rooms?.name ?? null,
      set_name: inspiration_sets?.name ?? null,
      author_name: author.data?.display_name ?? null,
    },
    packshot,
    packshots,
    tree: tree.map(withUrl),
  });
}

const patchSchema = z.object({
  action: z.enum(['trash', 'restore']),
});

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe dane żądania.' }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from('generations')
    .update({ deleted_at: parsed.data.action === 'trash' ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) {
    return NextResponse.json({ error: `Operacja nie powiodła się: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
