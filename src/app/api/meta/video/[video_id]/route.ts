import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getAccessTokenFor } from '@/lib/meta-ads';

const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// Server-side proxy do Meta video CDN.
// Meta zwraca video URL z scontent.xx.fbcdn.net z restrykcyjnym CORS,
// więc <video src="..."> w przeglądarce nie zadziała. Routing przez nasz
// serwer (server-to-server fetch nie ma CORS) i streamujemy do klienta
// z permissywnymi headerami.
//
// GET /api/meta/video/{video_id}
// Najpierw szukamy account_id przez creative który ma ten video_id w dim_creatives,
// żeby wybrać odpowiedni token z portfolio.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ video_id: string }> }
) {
  try {
    const { video_id: videoId } = await params;
    if (!videoId) {
      return NextResponse.json({ error: 'video_id required' }, { status: 400 });
    }

    // Znajdź account_id pierwszego creative który używa tego video
    const db = getSupabaseAdmin();
    const { data: creative } = await db
      .from('dim_creatives')
      .select('account_id')
      .eq('video_id', videoId)
      .limit(1)
      .maybeSingle();

    if (!creative?.account_id) {
      return NextResponse.json({ error: 'video not found in creative library' }, { status: 404 });
    }

    let token: string;
    try {
      token = getAccessTokenFor(creative.account_id as string);
    } catch {
      return NextResponse.json({ error: `no token for ${creative.account_id}` }, { status: 500 });
    }

    // 1. Pobierz source URL z Meta API
    const metaRes = await fetch(
      `${META_BASE_URL}/${videoId}?fields=source&access_token=${encodeURIComponent(token)}`
    );
    if (!metaRes.ok) {
      const text = await metaRes.text();
      return NextResponse.json(
        { error: `Meta /video error: ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }
    const metaData = await metaRes.json();
    const sourceUrl = metaData.source as string | undefined;
    if (!sourceUrl) {
      return NextResponse.json({ error: 'video has no source (private/expired?)' }, { status: 404 });
    }

    // 2. Forward Range header (do seekowania video bez ładowania całości)
    const rangeHeader = request.headers.get('range');
    const fwdHeaders: Record<string, string> = {};
    if (rangeHeader) fwdHeaders.Range = rangeHeader;

    // 3. Streamuj video przez nasz serwer
    const videoRes = await fetch(sourceUrl, { headers: fwdHeaders });
    if (!videoRes.ok || !videoRes.body) {
      return NextResponse.json(
        { error: `Meta video stream error: ${videoRes.status}` },
        { status: 502 }
      );
    }

    const contentType = videoRes.headers.get('content-type') || 'video/mp4';
    const contentLength = videoRes.headers.get('content-length');
    const acceptRanges = videoRes.headers.get('accept-ranges');
    const contentRange = videoRes.headers.get('content-range');

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    };
    if (contentLength) headers['Content-Length'] = contentLength;
    if (acceptRanges) headers['Accept-Ranges'] = acceptRanges;
    if (contentRange) headers['Content-Range'] = contentRange;

    return new NextResponse(videoRes.body, {
      status: videoRes.status, // 200 lub 206 dla range request
      headers,
    });
  } catch (err) {
    console.error('video proxy error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
