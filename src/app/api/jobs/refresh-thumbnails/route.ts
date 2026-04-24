import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchCreativeMeta } from '@/lib/meta-ads';

export const maxDuration = 60;

// Odświeża thumbnail_url dla istniejących kreacji — fetchuje HD preview
// z Meta przez fetchCreativeMeta() który teraz ma 6-poziomową hierarchię
// fallbacków (video.picture → image_url → object_story_spec → asset_feed_spec
// → adimages hash lookup → low-res thumbnail).
//
// POST ?limit=N (default 30, max 100)
// Default: TYLKO brakujące (null thumbnail_url) — typowy przypadek po deployu.
// ?force=1 — wymusza refresh WSZYSTKICH (również tych które już mają URL)
//            żeby podnieść jakość lub wymienić wygasłe scontent URL-e.
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limitParam = parseInt(searchParams.get('limit') || '30', 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 30;
  const force = searchParams.get('force') === '1' || searchParams.get('all') === '1';
  return refreshThumbnails(limit, force);
}

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const cronSecret = process.env.ETL_CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return refreshThumbnails(30, false);
}

async function refreshThumbnails(limit: number, force: boolean) {
  try {
    const db = getSupabaseAdmin();

    let query = db
      .from('dim_creatives')
      .select('creative_id, account_id, video_id, thumbnail_url')
      .order('last_seen_at', { ascending: false })
      .limit(limit);

    if (!force) {
      // Domyślnie: tylko te którym brakuje thumbnail (null)
      query = query.is('thumbnail_url', null);
    }

    const { data: creatives, error } = await query;
    if (error) throw new Error(`fetch creatives: ${error.message}`);
    if (!creatives || creatives.length === 0) {
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
