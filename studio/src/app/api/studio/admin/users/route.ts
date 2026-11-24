import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStudioAdmin } from '@/lib/studio/supabase-server';

export interface AdminUserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  is_admin: boolean;
  created_at: string | null;
  last_sign_in_at: string | null;
}

function serviceOrError() {
  if (!process.env.SUPABASE_SERVICE_KEY) {
    return NextResponse.json(
      { error: 'Brak klucza serwisowego (env SUPABASE_SERVICE_KEY w projekcie Vercel) — zarządzanie kontami wymaga go po stronie serwera.' },
      { status: 500 }
    );
  }
  return getSupabaseAdmin();
}

export async function GET() {
  const auth = await requireStudioAdmin();
  if (auth instanceof NextResponse) return auth;
  const service = serviceOrError();
  if (service instanceof NextResponse) return service;

  const { data: list, error } = await service.auth.admin.listUsers({ page: 1, perPage: 500 });
  if (error) {
    return NextResponse.json({ error: `Nie udało się pobrać użytkowników: ${error.message}` }, { status: 500 });
  }
  const { data: profiles } = await service.from('profiles').select('id, display_name, is_admin');
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const users: AdminUserRow[] = list.users
    .map((u) => ({
      id: u.id,
      email: u.email ?? null,
      display_name: profileById.get(u.id)?.display_name ?? null,
      is_admin: Boolean(profileById.get(u.id)?.is_admin),
      created_at: u.created_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
    }))
    .sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));

  return NextResponse.json({ users });
}

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email('Nieprawidłowy adres e-mail.'),
  password: z.string().min(8, 'Hasło musi mieć co najmniej 8 znaków.').max(72),
  displayName: z.string().trim().min(1, 'Podaj nazwę wyświetlaną.').max(120),
  isAdmin: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireStudioAdmin();
  if (auth instanceof NextResponse) return auth;
  const service = serviceOrError();
  if (service instanceof NextResponse) return service;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const { data: created, error } = await service.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: input.displayName },
  });
  if (error || !created.user) {
    const msg = error?.message ?? 'nieznany błąd';
    const friendly = /already.*registered|already.*exists/i.test(msg)
      ? 'Konto z tym adresem e-mail już istnieje.'
      : `Nie udało się utworzyć konta: ${msg}`;
    return NextResponse.json({ error: friendly }, { status: 400 });
  }

  // Trigger tworzy profil; upsert dopina nazwę i ewentualną flagę admina.
  await service.from('profiles').upsert({
    id: created.user.id,
    display_name: input.displayName,
    is_admin: input.isAdmin ?? false,
  });

  return NextResponse.json({
    user: {
      id: created.user.id,
      email: created.user.email ?? input.email,
      display_name: input.displayName,
      is_admin: input.isAdmin ?? false,
      created_at: created.user.created_at ?? new Date().toISOString(),
      last_sign_in_at: null,
    } satisfies AdminUserRow,
  });
}
