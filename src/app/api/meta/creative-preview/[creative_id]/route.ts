import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Server-side proxy do Meta Graph API /{creative_id}/previews.
// Zwraca URL iframe'a hostowanego przez Meta, który renderuje kreację
// w oficjalnym podglądzie Ad Library — full-res, działa przez signature
// w URL (nie wymaga naszego tokena po stronie klienta).

const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// Format w kolejności preferencji — dla bedroom/mattress kreacji
// mobile feed wygląda najbardziej reprezentatywnie.
const AD_FORMATS = [
  'MOBILE_FEED_STANDARD',
  'INSTAGRAM_STANDARD',
  'INSTAGRAM_STORY',
  'DESKTOP_FEED_STANDARD',
] as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ creative_id: string }> }
) {
  try {
    const { creative_id } = await params;
    if (!creative_id) {
      return NextResponse.json({ error: 'creative_id required' }, { status: 400 });
    }

    const db = getSupabaseAdmin();
    const { data: creative } = await db
      .from('dim_creatives')
      .select('account_id')
      .eq('creative_id', creative_id)
      .maybeSingle();

    if (!creative) {
      return NextResponse.json({ error: 'creative not found' }, { status: 404 });
    }

    // Lazy import — meta-ads.ts uruchamia się tylko gdy endpoint woła.
    const { getAccessTokenFor } = await import('@/lib/meta-ads');
    let token: string;
    try {
      token = getAccessTokenFor(creative.account_id as string);
    } catch (err) {
      return NextResponse.json({ error: `no token for ${creative.account_id}` }, { status: 500 });
    }

    // Spróbuj formatów po kolei — niektóre kreacje są tylko na IG, inne tylko FB.
    let lastError = '';
    for (const format of AD_FORMATS) {
      const url = `${META_BASE_URL}/${creative_id}/previews?ad_format=${format}&access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url);
      if (!res.ok) {
        lastError = await res.text();
        continue;
      }
      const json = await res.json();
      const body = json?.data?.[0]?.body;
      if (!body || typeof body !== 'string') continue;

      // Meta zwraca HTML iframe jako string — ekstrakcja src.
      const match = body.match(/src="([^"]+)"/);
      if (!match) continue;
      const iframeUrl = match[1].replace(/&amp;/g, '&');

      // Cache-Control: te iframe'y mają signature w URL z TTL, więc można
      // cache'ować na kilka godzin. Klient odświeży jeśli Meta zwróci 410.
      return NextResponse.json(
        { iframeUrl, format },
        {
          headers: {
            'Cache-Control': 'private, max-age=3600',
          },
        }
      );
    }

    return NextResponse.json(
      { error: `No preview available. Last error: ${lastError.slice(0, 200)}` },
      { status: 502 }
    );
  } catch (err) {
    console.error('creative-preview error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
