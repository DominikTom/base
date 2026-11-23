import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireStudioUser } from '@/lib/studio/supabase-server';
import type { CreatorTemplateRow } from '@/lib/studio/types';

/** Szablony ustawień kreatora ("Karta produktu 4:3", "Stories złota godzina"…). */

const payloadSchema = z
  .object({
    roomIds: z.array(z.string().uuid()).max(4).optional(),
    styleText: z.string().max(2000).optional(),
    inspirationSetId: z.string().uuid().nullish(),
    inspirationStrength: z.number().int().min(1).max(5).optional(),
    manualNotes: z.string().max(2000).optional(),
    aspectRatio: z.enum(['1:1', '3:4', '9:16', '4:3', '16:9']).optional(),
    cameraShot: z.enum(['auto', 'wide', 'medium', 'close']).optional(),
    cameraAngle: z
      .enum(['auto', 'front', 'three-quarter-left', 'three-quarter-right', 'side', 'low', 'elevated'])
      .optional(),
    lighting: z
      .enum(['auto', 'morning', 'daylight-soft', 'golden', 'evening', 'studio'])
      .optional(),
    models: z.array(z.string()).max(3).optional(),
    variants: z.number().int().min(1).max(4).optional(),
    imageSize: z.enum(['2K', '4K']).optional(),
  })
  .strip();

export async function GET() {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await auth.supabase
    .from('creator_templates')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: `Nie udało się pobrać szablonów: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ templates: (data ?? []) as CreatorTemplateRow[] });
}

const createSchema = z.object({
  name: z.string().min(1, 'Podaj nazwę szablonu.').max(120),
  payload: payloadSchema,
});

export async function POST(request: NextRequest) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane szablonu.' },
      { status: 400 }
    );
  }

  const { data, error } = await auth.supabase
    .from('creator_templates')
    .insert({ user_id: auth.user.id, name: parsed.data.name, payload: parsed.data.payload })
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: `Nie udało się zapisać szablonu: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ template: data as CreatorTemplateRow });
}
