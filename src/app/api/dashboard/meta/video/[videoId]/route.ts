import { NextRequest, NextResponse } from 'next/server';
import { fetchVideoSource, getAdAccountIds } from '@/lib/meta-ads';

export const maxDuration = 300;

// GET /api/dashboard/meta/video/{videoId}?account=act_...
//
// Streaming wideo HD przez własny serwer — warstwa #2 podglądu. Zamiast
// miniaturki 64×64 odtwarzamy oryginalny MP4 z fbcdn. Świeży, podpisany URL
// źródła pobierany jest przy KAŻDYM żądaniu (podpisy wygasają), a przeglądarka
// zna tylko stabilny URL tego proxy. fbcdn blokuje CORS — proxy przez własną
// domenę rozwiązuje to całkowicie.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  const accountId = new URL(request.url).searchParams.get('account') || '';

  if (!/^\d+$/.test(videoId)) {
    return NextResponse.json({ error: 'Invalid videoId' }, { status: 400 });
  }
  if (!getAdAccountIds().includes(accountId)) {
    return NextResponse.json({ error: 'Unknown ad account' }, { status: 400 });
  }

  try {
    const { source } = await fetchVideoSource(videoId, accountId);
    if (!source) {
      // Np. wideo katalogowe/Advantage+ — source bywa niedostępne mimo tokena
      return NextResponse.json({ error: 'Video source unavailable' }, { status: 404 });
    }

    // Forward Range w obie strony — bez tego nie działa przewijanie,
    // a Safari/iOS w ogóle wymaga odpowiedzi 206.
    const fetchHeaders: Record<string, string> = {};
    const rangeHeader = request.headers.get('range');
    if (rangeHeader) fetchHeaders['Range'] = rangeHeader;

    const videoRes = await fetch(source, { headers: fetchHeaders });
    if (videoRes.status !== 200 && videoRes.status !== 206) {
      return NextResponse.json({ error: `Upstream ${videoRes.status}` }, { status: 502 });
    }

    const headers = new Headers({
      'Content-Type': videoRes.headers.get('content-type') || 'video/mp4',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    for (const h of ['content-length', 'content-range', 'accept-ranges'] as const) {
      const v = videoRes.headers.get(h);
      if (v) headers.set(h, v);
    }

    // Pipe strumienia — bez buforowania całego pliku w pamięci
    return new Response(videoRes.body, { status: videoRes.status, headers });
  } catch (err) {
    console.error('meta/video error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
