import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getAccessTokenFor } from '@/lib/meta-ads';

const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// Server-side dynamic resolver dla HD video poster.
// /{video_id}?fields=picture zwraca świeży URL CDN każdym razem (URL-e
// scontent.xx.fbcdn.net mają TTL, więc nie chcemy ich zapisywać w DB).
//
// GET /api/meta/video-poster/{video_id}
// → 302 redirect na CDN URL (przeglądarka follow'uje, browser cache itd.)
//
// Używane jako poster atrybut w <video> i jako fallback src dla video
// kreacji w gridzie — niezależnie od stanu dim_creatives.thumbnail_url
// dostajemy zawsze HD obrazek.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ video_id: string }> }
) {
  try {
    const { video_id: videoId } = await params;
    if (!videoId) {
      return NextResponse.json({ error: 'video_id required' }, { status: 400 });
    }

    // Lookup account_id przez creative który używa tego video — żeby wybrać
    // odpowiedni token z portfolio (per-brand tokens).
    const db = getSupabaseAdmin();
    const { data: creative } = await db
      .from('dim_creatives')
      .select('account_id')
      .eq('video_id', videoId)
      .limit(1)
      .maybeSingle();

    if (!creative?.account_id) {
      return NextResponse.json({ error: 'video not found in library' }, { status: 404 });
    }

    let token: string;
    try {
      token = getAccessTokenFor(creative.account_id as string);
    } catch {
      return NextResponse.json({ error: `no token for ${creative.account_id}` }, { status: 500 });
    }

    const metaRes = await fetch(
      `${META_BASE_URL}/${videoId}?fields=picture&access_token=${encodeURIComponent(token)}`
    );
    if (!metaRes.ok) {
      const text = await metaRes.text();
      return NextResponse.json(
        { error: `Meta /picture error: ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }
    const metaData = await metaRes.json();
    const pictureUrl = metaData.picture as string | undefined;
    if (!pictureUrl) {
      return NextResponse.json({ error: 'video has no picture' }, { status: 404 });
    }

    // 302 redirect — przeglądarka follow'uje na CDN, dostaje binary obrazka,
    // cachuje normalnie. Bez ciężkiego streamowania binarnego przez nas.
    return NextResponse.redirect(pictureUrl, 302);
  } catch (err) {
    console.error('video-poster error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
