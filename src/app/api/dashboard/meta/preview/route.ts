import { NextRequest, NextResponse } from 'next/server';
import { fetchAdPreviewHtml, getAdAccountIds } from '@/lib/meta-ads';

// GET /api/dashboard/meta/preview?adId=...&account=act_...&format=DESKTOP_FEED_STANDARD
//
// Natywny podgląd Meta (iframe) — warstwa #1 podglądu kreacji. Zwraca gotowy
// HTML <iframe> renderujący reklamę jak w prawdziwym feedzie (z odtwarzalnym
// wideo, CTA, tekstem). Iframe src jest podpisanym URL-em facebook.com i działa
// w przeglądarce bez tokena. Token zostaje wyłącznie na serwerze.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const adId = searchParams.get('adId') || '';
  const accountId = searchParams.get('account') || '';
  const format = searchParams.get('format') || undefined;

  if (!/^\d+$/.test(adId)) {
    return NextResponse.json({ error: 'Invalid adId' }, { status: 400 });
  }
  if (!getAdAccountIds().includes(accountId)) {
    return NextResponse.json({ error: 'Unknown ad account' }, { status: 400 });
  }

  try {
    const preview = await fetchAdPreviewHtml(adId, accountId, format);
    if (!preview) {
      return NextResponse.json({ error: 'No preview available' }, { status: 404 });
    }
    // Podpisany URL w iframe wygasa — każde otwarcie modalu ma dostać świeży
    return NextResponse.json(
      { preview: preview.html, format: preview.format },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('meta/preview error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
