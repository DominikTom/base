import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchCreativeMeta } from '@/lib/meta-ads';
import { storeCreativeImages } from '@/lib/creative-thumbs';

export const maxDuration = 60;

// Odświeża metadane miniatur z Meta (fetchCreativeMeta — 6-poziomowa
// hierarchia fallbacków: video.picture → image_url → object_story_spec →
// asset_feed_spec → adimages hash → low-res thumbnail) i KOPIUJE obraz do
// Supabase Storage (bucket creative-thumbs), bo linki fbcdn wygasają.
//
// GET (Vercel Cron co 10 min): kreacje bez kopii w Storage, 25 na przebieg.
// POST ?limit=N (domyślnie 100, max 100): odśwież najpierw bez miniatury,
//      potem najnowsze; ?only_missing=1 — tylko thumbnail_url IS NULL.

const CONCURRENCY = 5;

interface CreativeRef {
  creative_id: string;
  account_id: string;
}

export async function POST(request: NextRequest) {
  const _guard = await requireAdmin();
  if (_guard) return _guard;
  const { searchParams } = new URL(request.url);
  const limitParam = parseInt(searchParams.get('limit') || '100', 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 100;
  const onlyMissing = searchParams.get('only_missing') === '1';
  try {
    return NextResponse.json(await refresh(await pickForRefresh(limit, onlyMissing)));
  } catch (err) {
    console.error('refresh-thumbnails error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  const _guard = await requireAdmin();
  if (_guard) return _guard;
  const db = getSupabaseAdmin();
  const { data: log } = await db.from('etl_log')
    .insert({ source: 'creative_thumbs', started_at: new Date().toISOString(), status: 'running' })
    .select('id').single();
  try {
    const { data, error } = await db.from('dim_creatives')
      .select('creative_id, account_id')
      .is('thumb_storage_path', null)
      .or('is_dynamic.is.null,is_dynamic.eq.false')
      .order('last_seen_at', { ascending: false })
      .limit(25);
    if (error) throw new Error(`fetch missing: ${error.message}`);
    const result = await refresh((data || []) as CreativeRef[]);
    const { count: remaining } = await db.from('dim_creatives')
      .select('creative_id', { count: 'exact', head: true })
      .is('thumb_storage_path', null)
      .or('is_dynamic.is.null,is_dynamic.eq.false');
    if (log?.id) {
      await db.from('etl_log').update({
        status: 'success', finished_at: new Date().toISOString(),
        rows_processed: result.processed, rows_inserted: result.stored,
        error_message: `stored=${result.stored} failed=${result.failed} remaining=${remaining ?? 0}`,
      }).eq('id', log.id);
    }
    return NextResponse.json({ ...result, remaining: remaining ?? 0 });
  } catch (err) {
    if (log?.id) {
      await db.from('etl_log').update({ status: 'error', finished_at: new Date().toISOString(), error_message: String(err) }).eq('id', log.id);
    }
    console.error('refresh-thumbnails cron error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function pickForRefresh(limit: number, onlyMissing: boolean): Promise<CreativeRef[]> {
  const db = getSupabaseAdmin();
  // Najpierw kreacje bez miniatury, potem najnowsze. DPA (is_dynamic) pomijamy —
  // Meta nie zwraca dla nich miniatury i odświeżenie ich nie naprawi.
  const { data: nullThumbs, error: e1 } = await db.from('dim_creatives')
    .select('creative_id, account_id')
    .is('thumbnail_url', null)
    .or('is_dynamic.is.null,is_dynamic.eq.false')
    .order('last_seen_at', { ascending: false })
    .limit(limit);
  if (e1) throw new Error(`fetch nullThumbs: ${e1.message}`);
  const picked = (nullThumbs || []) as CreativeRef[];
  if (!onlyMissing && picked.length < limit) {
    const { data: rest, error: e2 } = await db.from('dim_creatives')
      .select('creative_id, account_id')
      .not('thumbnail_url', 'is', null)
      .or('is_dynamic.is.null,is_dynamic.eq.false')
      .order('last_seen_at', { ascending: false })
      .limit(limit - picked.length);
    if (e2) throw new Error(`fetch rest: ${e2.message}`);
    picked.push(...((rest || []) as CreativeRef[]));
  }
  return picked;
}

async function refresh(creatives: CreativeRef[]) {
  const db = getSupabaseAdmin();
  let succeeded = 0;
  let stored = 0;
  let failed = 0;
  const errors: string[] = [];

  async function one(c: CreativeRef) {
    try {
      const meta = await fetchCreativeMeta(c.creative_id, c.account_id);
      if (!meta) { failed += 1; return; }
      const storagePatch = await storeCreativeImages(db, c.creative_id, meta.thumbnailUrl, meta.imageUrl);
      const { error } = await db.from('dim_creatives').update({
        thumbnail_url: meta.thumbnailUrl,
        image_url: meta.imageUrl,
        video_id: meta.videoId,
        format: meta.format,
        auto_tags: meta.autoTags,
        is_dynamic: meta.isDynamic,
        last_seen_at: new Date().toISOString(),
        ...storagePatch,
      }).eq('creative_id', c.creative_id);
      if (error) {
        failed += 1;
        errors.push(`${c.creative_id}: ${error.message}`);
        return;
      }
      succeeded += 1;
      if (storagePatch.thumb_storage_path) stored += 1;
    } catch (err) {
      failed += 1;
      errors.push(`${c.creative_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (let i = 0; i < creatives.length; i += CONCURRENCY) {
    await Promise.all(creatives.slice(i, i + CONCURRENCY).map(one));
  }
  return { processed: creatives.length, succeeded, stored, failed, errors: errors.slice(0, 5) };
}
