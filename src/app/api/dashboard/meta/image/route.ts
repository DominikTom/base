import { NextRequest, NextResponse } from 'next/server';
import { getAccessTokenFor, getAdAccountIds, resolveAdImageUrl } from '@/lib/meta-ads';

// GET /api/dashboard/meta/image?url=...&account=act_...   (tryb URL)
// GET /api/dashboard/meta/image?adId=...&account=act_...  (tryb świeżego URL-a z API)
//
// Proxy obrazków — warstwa #3 podglądu. URL-e fbcdn są podpisane i wygasają,
// więc tryb ?adId= pobiera świeży URL łańcuchem priorytetów (image_url →
// object_story_spec → miniatury wideo → adimages po hashu → thumbnail_url).
// Frontend używa onError na <img> do przełączenia ?url= → ?adId=.

// Allowlista domen — obowiązkowe zabezpieczenie przed SSRF.
function isAllowedImageHost(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return (
    host === 'fbcdn.net' || host.endsWith('.fbcdn.net') ||
    host === 'facebook.com' || host.endsWith('.facebook.com') ||
    host === 'fb.com' || host.endsWith('.fb.com')
  );
}

async function serveImage(imageUrl: string, accountId: string | null): Promise<Response> {
  let res = await fetch(imageUrl);

  // URL mógł wygasnąć — retry z doklejonym tokenem (dzieje się wyłącznie
  // serwerowo; token nigdy nie trafia do przeglądarki).
  if (!res.ok && accountId) {
    try {
      const token = getAccessTokenFor(accountId);
      const sep = imageUrl.includes('?') ? '&' : '?';
      res = await fetch(`${imageUrl}${sep}access_token=${encodeURIComponent(token)}`);
    } catch { /* konto bez tokena — zostaje pierwotny błąd */ }
  }

  if (!res.ok) {
    return NextResponse.json({ error: `Upstream ${res.status}` }, { status: 502 });
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const adId = searchParams.get('adId');
  const accountParam = searchParams.get('account') || '';
  const accountId = getAdAccountIds().includes(accountParam) ? accountParam : null;

  try {
    if (url) {
      if (!isAllowedImageHost(url)) {
        return NextResponse.json({ error: 'Domain not allowed' }, { status: 403 });
      }
      return await serveImage(url, accountId);
    }

    if (adId) {
      if (!/^\d+$/.test(adId)) {
        return NextResponse.json({ error: 'Invalid adId' }, { status: 400 });
      }
      if (!accountId) {
        return NextResponse.json({ error: 'Unknown ad account' }, { status: 400 });
      }
      const freshUrl = await resolveAdImageUrl(adId, accountId);
      if (!freshUrl || !isAllowedImageHost(freshUrl)) {
        return NextResponse.json({ error: 'No image available' }, { status: 404 });
      }
      return await serveImage(freshUrl, accountId);
    }

    return NextResponse.json({ error: 'url or adId required' }, { status: 400 });
  } catch (err) {
    console.error('meta/image error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
