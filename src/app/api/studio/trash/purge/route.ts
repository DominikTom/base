import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { purgeExpired } from '@/lib/studio/purge';
import { requireStudioUser } from '@/lib/studio/supabase-server';

export const maxDuration = 300;

/**
 * Cron (Vercel, raz dziennie): trwale usuwa elementy z kosza starsze niż 30 dni
 * wraz z plikami ze Storage. Vercel wysyła `Authorization: Bearer ${CRON_SECRET}`,
 * jeśli env var CRON_SECRET jest ustawiony; bez sekretu dopuszczamy wywołanie
 * ręczne przez zalogowanego użytkownika studia.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (cronSecret) {
    if (authHeader !== `Bearer ${cronSecret}`) {
      const auth = await requireStudioUser();
      if (auth instanceof NextResponse) return auth;
    }
  } else {
    const auth = await requireStudioUser();
    if (auth instanceof NextResponse) return auth;
  }

  try {
    // Service role — cron działa bez sesji użytkownika, a czyścić trzeba
    // niezależnie od tego, kto usunął element.
    const admin = getSupabaseAdmin();
    const counts = await purgeExpired(admin, 30);
    return NextResponse.json({ ok: true, purged: counts });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
