import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStudioUser } from '@/lib/studio/supabase-server';

export interface EditorPresetRow {
  id: string;
  user_id: string;
  name: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export async function GET() {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await auth.supabase
    .from('editor_presets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: `Nie udało się pobrać presetów: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ presets: (data ?? []) as EditorPresetRow[] });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  payload: z.object({
    brightness: z.number().int().min(-50).max(50),
    contrast: z.number().int().min(-50).max(50),
    saturation: z.number().int().min(-50).max(50),
    temperature: z.number().int().min(-50).max(50),
    vignette: z.number().int().min(0).max(100),
    grayscale: z.boolean(),
  }),
});

export async function POST(request: NextRequest) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe dane presetu.' }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from('editor_presets')
    .insert({ user_id: auth.user.id, name: parsed.data.name, payload: parsed.data.payload })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: `Nie udało się zapisać presetu: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ preset: data as EditorPresetRow });
}
