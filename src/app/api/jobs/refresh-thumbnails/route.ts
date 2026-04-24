import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchCreativeMeta } from '@/lib/meta-ads';

export const maxDuration = 60;

// Odświeża thumbnail_url dla istniejących kreacji — fetchuje HD preview
// z Meta (dla wideo via /{video_id}?fields=picture, dla static via image_url).
// Używane po pierwszym deployu żeby naprawić low-res thumbnails bez
// robienia full re-syncu fact_daily_ad_performance.
//
// POST ?limit=N (default 30, max 100)
// Domyślnie: tylko kreacje z video_id (to tam Meta zwraca 64×64 thumbnail).
// ?all=1 — także static (mają już image_url HD, ale dla spójności też można).
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limitParam = parseInt(searchParams.get('limit') || '30', 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 30;
  const refreshAll = searchParams.get('all') === '1';
  return refreshThumbnails(limit, refreshAll);
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

async function refreshThumbnails(limit: number, refreshAll: boolean) {
  try {
    const db = getSupabaseAdmin();

    let query = db
      .from('dim_creatives')
      .select('creative_id, account_id, video_id, thumbnail_url')
      .order('last_seen_at', { ascending: false })
      .limit(limit);

    if (!refreshAll) {
      // Domyślnie: tylko wideo — to tam Meta zwraca low-res thumbnail.
      // Static creatives mają już image_url w HD z AdCreative.
      query = query.not('video_id', 'is', null);
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
