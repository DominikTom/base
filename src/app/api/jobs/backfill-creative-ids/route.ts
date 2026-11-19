import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchCreativeIdsForAds, fetchCreativeMeta } from '@/lib/meta-ads';
import { storeCreativeImages } from '@/lib/creative-thumbs';

export const maxDuration = 60;

// Uzupełnia creative_id w fact_daily_ad_performance dla wierszy, w których
// zostało puste. meta-ad-sync mapuje reklamy tylko w swoim oknie (14 dni),
// więc wiersze, którym mapowanie nie wyszło (np. paczka ?ids= odrzucona przez
// jedną usuniętą reklamę), zostawały puste na zawsze.
//
// Kolejność: 1) mapowanie z innych wierszy tej samej reklamy (bez API),
// 2) Meta Graph API (fetchCreativeIdsForAds), 3) nowe kreacje → dim_creatives
// (+ kopia miniatury w Storage, status tagowania AI 'pending').
//
// GET (Vercel Cron) / POST ?days=N (domyślnie 90, max 400) &max_ads=N (domyślnie 200).

const PAGE = 1000;

export async function GET() {
  const _guard = await requireAdmin();
  if (_guard) return _guard;
  return run(90, 200);
}

export async function POST(request: NextRequest) {
  const _guard = await requireAdmin();
  if (_guard) return _guard;
  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '90', 10) || 90, 1), 400);
  const maxAds = Math.min(Math.max(parseInt(searchParams.get('max_ads') || '200', 10) || 200, 1), 1000);
  return run(days, maxAds);
}

async function run(days: number, maxAds: number) {
  const db = getSupabaseAdmin();
  const { data: log } = await db.from('etl_log')
    .insert({ source: 'creative_backfill', started_at: new Date().toISOString(), status: 'running' })
    .select('id').single();
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    // 1. Reklamy z pustym creative_id w oknie.
    const accountByAd = new Map<string, string>();
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await db.from('fact_daily_ad_performance')
        .select('ad_id, account_id, date')
        .eq('platform', 'meta').is('creative_id', null).gte('date', since)
        .order('date', { ascending: false }).order('ad_id', { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(`fact rows: ${error.message}`);
      for (const r of data || []) accountByAd.set(r.ad_id as string, r.account_id as string);
      if (!data || data.length < PAGE) break;
    }
    const adIds = [...accountByAd.keys()].slice(0, maxAds);

    // 2. Mapowanie z innych wierszy tej samej reklamy.
    const creativeByAd = new Map<string, string>();
    for (let i = 0; i < adIds.length; i += 200) {
      const chunk = adIds.slice(i, i + 200);
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await db.from('fact_daily_ad_performance')
          .select('ad_id, creative_id')
          .in('ad_id', chunk).not('creative_id', 'is', null)
          .order('ad_id', { ascending: true }).order('date', { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw new Error(`known mapping: ${error.message}`);
        for (const r of data || []) creativeByAd.set(r.ad_id as string, r.creative_id as string);
        if (!data || data.length < PAGE) break;
      }
    }
    const fromDb = creativeByAd.size;

    // 3. Reszta z Meta API, per konto.
    const byAccount = new Map<string, string[]>();
    for (const adId of adIds) {
      if (creativeByAd.has(adId)) continue;
      const acc = accountByAd.get(adId)!;
      byAccount.set(acc, [...(byAccount.get(acc) || []), adId]);
    }
    let fromApi = 0;
    const apiErrors: string[] = [];
    for (const [accountId, ids] of byAccount) {
      try {
        const fetched = await fetchCreativeIdsForAds(accountId, ids);
        for (const [adId, creativeId] of fetched) { creativeByAd.set(adId, creativeId); fromApi += 1; }
      } catch (err) {
        apiErrors.push(`${accountId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 4. Zapis creative_id w wierszach faktów.
    let updatedAds = 0;
    for (const [adId, creativeId] of creativeByAd) {
      const { error } = await db.from('fact_daily_ad_performance')
        .update({ creative_id: creativeId })
        .eq('platform', 'meta').eq('ad_id', adId).is('creative_id', null);
      if (!error) updatedAds += 1;
    }

    // 5. Kreacje, których nie ma jeszcze w dim_creatives (max 20 na przebieg).
    const creativeIds = [...new Set(creativeByAd.values())];
    const known = new Set<string>();
    for (let i = 0; i < creativeIds.length; i += 200) {
      const { data } = await db.from('dim_creatives').select('creative_id').in('creative_id', creativeIds.slice(i, i + 200));
      for (const r of data || []) known.add(r.creative_id as string);
    }
    const accountByCreative = new Map<string, string>();
    for (const [adId, creativeId] of creativeByAd) accountByCreative.set(creativeId, accountByAd.get(adId)!);
    let newCreatives = 0;
    for (const creativeId of creativeIds.filter(id => !known.has(id)).slice(0, 20)) {
      const meta = await fetchCreativeMeta(creativeId, accountByCreative.get(creativeId)!);
      if (!meta) continue;
      const storagePatch = await storeCreativeImages(db, meta.creativeId, meta.thumbnailUrl, meta.imageUrl);
      await db.from('dim_creatives').upsert({
        creative_id: meta.creativeId, account_id: meta.accountId,
        title: meta.title, body: meta.body, call_to_action_type: meta.callToActionType,
        thumbnail_url: meta.thumbnailUrl, image_url: meta.imageUrl, video_id: meta.videoId,
        permalink_url: meta.permalinkUrl, format: meta.format, auto_tags: meta.autoTags,
        is_dynamic: meta.isDynamic, ai_tag_status: 'pending',
        first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
        ...storagePatch,
      }, { onConflict: 'creative_id' });
      newCreatives += 1;
    }

    const result = {
      window_from: since,
      ads_without_creative: accountByAd.size,
      ads_checked: adIds.length,
      resolved_from_db: fromDb,
      resolved_from_api: fromApi,
      unresolved: adIds.length - creativeByAd.size,
      ads_updated: updatedAds,
      new_creatives: newCreatives,
      api_errors: apiErrors.slice(0, 5),
    };
    if (log?.id) {
      await db.from('etl_log').update({
        status: 'success', finished_at: new Date().toISOString(),
        rows_processed: adIds.length, rows_updated: updatedAds,
        details: result,
      }).eq('id', log.id);
    }
    return NextResponse.json(result);
  } catch (err) {
    if (log?.id) {
      await db.from('etl_log').update({ status: 'error', finished_at: new Date().toISOString(), error_message: String(err) }).eq('id', log.id);
    }
    console.error('backfill-creative-ids error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
