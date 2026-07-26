import { NextResponse, type NextRequest } from 'next/server';
import { requireStudioUser } from '@/lib/studio/supabase-server';

const BUCKETS = new Set(['packshots', 'inspirations', 'generations']);

/**
 * Same-origin proxy plików ze Storage. Autoryzacja sesją użytkownika + RLS
 * bucketów; dzięki temu obrazy działają w <img> i na canvasie bez problemów
 * CORS i bez wygasających signed URLs.
 */
export async function GET(request: NextRequest) {
  const auth = await requireStudioUser();
  if (auth instanceof NextResponse) return auth;

  const bucket = request.nextUrl.searchParams.get('b') ?? '';
  const path = request.nextUrl.searchParams.get('p') ?? '';
  const download = request.nextUrl.searchParams.get('download');

  if (!BUCKETS.has(bucket) || !path || path.includes('..')) {
    return NextResponse.json({ error: 'Nieprawidłowe parametry pliku.' }, { status: 400 });
  }

  const { data, error } = await auth.supabase.storage.from(bucket).download(path);
  if (error || !data) {
    return NextResponse.json({ error: 'Nie znaleziono pliku.' }, { status: 404 });
  }

  const headers = new Headers({
    'Content-Type': data.type || 'image/png',
    'Cache-Control': 'private, max-age=3600',
  });
  if (download) {
    const filename = path.split('/').pop() ?? 'obraz.png';
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);
  }
  return new NextResponse(data.stream(), { headers });
}
