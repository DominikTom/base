import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchCreativeMeta } from '@/lib/meta-ads';

export const maxDuration = 60;

// Odświeża thumbnail_url dla istniejących kreacji — fetchuje HD preview
// z Meta przez fetchCreativeMeta() który teraz ma 6-poziomową hierarchię
// fallbacków (video.picture → image_url → object_story_spec → asset_feed_spec
// → adimages hash lookup → low-res thumbnail).
//
// POST ?limit=N (default 30, max 100)
// Default: refresh WSZYSTKICH (najnowsze najpierw) — podmienia low-res/expired URL-e.
// ?only_missing=1 — tylko te z thumbnail_url IS NULL.
export async function POST(request: NextRequest) {
  const _guard = await requireAdmin();
  if (_guard) return _guard;
  const { searchParams } = new URL(request.url);
  const limitParam = parseInt(searchParams.get('limit') || '100', 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 100;
  const onlyMissing = searchParams.get('only_missing') === '1';
  return refreshThumbnails(limit, onlyMissing);
}

export async function GET(request: NextRequest) {
  const _guard = await requireAdmin();
  if (_guard) return _guard;
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const cronSecret = process.env.ETL_CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return refreshThumbnails(100, false);
}

async function refreshThumbnails(limit: number, onlyMissing: boolean) {
  try {
    const db = getSupabaseAdmin();

    // Strategia: NAJPIERW pobierz kreacje z thumbnail_url IS NULL (priorytet),
    // potem dopełnij do limitu pozostałymi (sort: najnowsze first).
    // Wyklucz wykryte DPA (is_dynamic = true) — Meta nie zwraca dla nich
    // thumbnail i refresh nigdy ich nie naprawi.
    const { data: nullThumbs, error: e1 } = await db
      .from('dim_creatives')
      .select('creative_id, account_id, video_id, thumbnail_url, is_dynamic')
      .is('thumbnail_url', null)
      .or('is_dynamic.is.null,is_dynamic.eq.false')
      .order('last_seen_at', { ascending: false })
      .limit(limit);
    if (e1) throw new Error(`fetch nullThumbs: ${e1.message}`);

    let creatives = nullThumbs || [];

    if (!onlyMissing && creatives.length < limit) {
      const remaining = limit - creatives.length;
      const { data: rest, error: e2 } = await db
        .from('dim_creatives')
        .select('creative_id, account_id, video_id, thumbnail_url, is_dynamic')
        .not('thumbnail_url', 'is', null)
        .or('is_dynamic.is.null,is_dynamic.eq.false')
        .order('last_seen_at', { ascending: false })
        .limit(remaining);
      if (e2) throw new Error(`fetch rest: ${e2.message}`);
      creatives = [...creatives, ...(rest || [])];
    }

    if (creatives.length === 0) {
      return NextResponse.json({ processed: 0, succeeded: 0, failed: 0, message: 'nothing to refresh' });
    }

    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const c of creatives) {
      try {
        const meta = await fetchCreativeMeta(c.creative_id as string, c.account_id as string);
        if (!meta) {
          failed += 1;
          continue;
        }
        const { error: upErr } = await db.from('dim_creatives').update({
          thumbnail_url: meta.thumbnailUrl,
          image_url: meta.imageUrl,
          video_id: meta.videoId,
          format: meta.format,
          auto_tags: meta.autoTags,
          is_dynamic: meta.isDynamic,
          last_seen_at: new Date().toISOString(),
        }).eq('creative_id', c.creative_id);
        if (upErr) {
          failed += 1;
          errors.push(`${c.creative_id}: ${upErr.message}`);
        } else {
          succeeded += 1;
        }
      } catch (err) {
        failed += 1;
        errors.push(`${c.creative_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return NextResponse.json({
      processed: creatives.length,
      succeeded,
      failed,
      errors: errors.slice(0, 5),
    });
  } catch (err) {
    console.error('refresh-thumbnails error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
