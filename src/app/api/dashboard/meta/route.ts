import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { SHOP_TO_META_ACCOUNT } from '@/lib/meta-ads';

// Paginated fetch — Supabase PostgREST ma default cap 1000.
async function fetchAllAdPerf(params: {
  dateFrom: string;
  dateTo: string;
  accountId: string | null;
  campaignId?: string | null;
  adsetId?: string | null;
}): Promise<Array<Record<string, unknown>>> {
  const db = getSupabaseAdmin();
  const PAGE_SIZE = 1000;
  const rows: Array<Record<string, unknown>> = [];
  let offset = 0;
  while (true) {
    let q = db.from('fact_daily_ad_performance')
      .select('*')
      .gte('date', params.dateFrom)
      .lte('date', params.dateTo)
      .order('date', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (params.accountId) q = q.eq('account_id', params.accountId);
    if (params.campaignId) q = q.eq('campaign_id', params.campaignId);
    if (params.adsetId) q = q.eq('adset_id', params.adsetId);
    const { data, error } = await q;
    if (error) throw new Error(`fact_daily_ad_performance: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as Array<Record<string, unknown>>));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

type LevelAgg = {
  id: string;
  name: string;
  parent_id?: string;
  parent_name?: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  video_play_3s: number;
  ads: Set<string>;
  adsets: Set<string>;
  creatives: Set<string>;
};

function makeEmpty(id: string, name: string, parent_id?: string, parent_name?: string): LevelAgg {
  return {
    id, name, parent_id, parent_name,
    spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0, video_play_3s: 0,
    ads: new Set(), adsets: new Set(), creatives: new Set(),
  };
}

function buildLevelMap(
  rows: Array<Record<string, unknown>>,
  keyField: 'campaign_id' | 'adset_id'
): Map<string, LevelAgg> {
  const map = new Map<string, LevelAgg>();
  for (const r of rows) {
    const key = r[keyField] as string | null;
    if (!key) continue;
    const name = keyField === 'campaign_id'
      ? (r.campaign_name as string | null) || key
      : (r.adset_name as string | null) || key;
    const cur = map.get(key) || makeEmpty(
      key, name,
      keyField === 'adset_id' ? (r.campaign_id as string) : undefined,
      keyField === 'adset_id' ? (r.campaign_name as string) : undefined,
    );
    cur.spend += Number(r.spend) || 0;
    cur.impressions += Number(r.impressions) || 0;
    cur.clicks += Number(r.clicks) || 0;
    cur.conversions += Number(r.conversions) || 0;
    cur.conversion_value += Number(r.conversion_value) || 0;
    cur.video_play_3s += Number(r.video_play_3s) || 0;
    if (r.ad_id) cur.ads.add(r.ad_id as string);
    if (r.adset_id) cur.adsets.add(r.adset_id as string);
    if (r.creative_id) cur.creatives.add(r.creative_id as string);
    map.set(key, cur);
  }
  return map;
}

function aggRow(a: LevelAgg) {
  return {
    id: a.id,
    name: a.name,
    parent_id: a.parent_id || null,
    parent_name: a.parent_name || null,
    spend: Math.round(a.spend),
    impressions: a.impressions,
    clicks: a.clicks,
    conversions: a.conversions,
    conversion_value: Math.round(a.conversion_value),
    roas: a.spend > 0 ? Math.round((a.conversion_value / a.spend) * 100) / 100 : 0,
    ctr: a.impressions > 0 ? Math.round((a.clicks / a.impressions) * 10000) / 100 : 0,
    cpa: a.conversions > 0 ? Math.round((a.spend / a.conversions) * 100) / 100 : 0,
    hook_rate: a.impressions > 0 ? Math.round((a.video_play_3s / a.impressions) * 10000) / 100 : 0,
    ads_count: a.ads.size,
    adsets_count: a.adsets.size,
    creatives_count: a.creatives.size,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from') || '2025-01-01';
    const dateTo = searchParams.get('date_to') || new Date().toISOString().split('T')[0];
    const shop = searchParams.get('shop') || 'all';
    const accountIdFilter = shop === 'all' ? null : (SHOP_TO_META_ACCOUNT[shop] ?? 'NONE');
    const level = (searchParams.get('level') || 'creative') as 'campaign' | 'adset' | 'creative';
    const campaignId = searchParams.get('campaign_id') || null;
    const adsetId = searchParams.get('adset_id') || null;

    const db = getSupabaseAdmin();

    const adRows = await fetchAllAdPerf({
      dateFrom, dateTo,
      accountId: accountIdFilter,
      campaignId, adsetId,
    });

    // Poprzedni okres tej samej długości — do obliczania deltów WoW.
    // Jeśli okres = 7 dni, prevDateFrom = today-14, prevDateTo = today-7.
    const dateFromMs = new Date(dateFrom).getTime();
    const dateToMs = new Date(dateTo).getTime();
    const periodMs = dateToMs - dateFromMs + 86_400_000; // +1 dzień (inclusive)
    const prevDateFrom = new Date(dateFromMs - periodMs).toISOString().split('T')[0];
    const prevDateTo = new Date(dateFromMs - 86_400_000).toISOString().split('T')[0];
    const prevRows = await fetchAllAdPerf({
      dateFrom: prevDateFrom, dateTo: prevDateTo,
      accountId: accountIdFilter,
      campaignId, adsetId,
    });

    function aggregateTotals(rows: Array<Record<string, unknown>>) {
      const t = { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, videoPlay3s: 0 };
      for (const r of rows) {
        t.spend += Number(r.spend) || 0;
        t.impressions += Number(r.impressions) || 0;
        t.clicks += Number(r.clicks) || 0;
        t.conversions += Number(r.conversions) || 0;
        t.conversionValue += Number(r.conversion_value) || 0;
        t.videoPlay3s += Number(r.video_play_3s) || 0;
      }
      return t;
    }

    function delta(curr: number, prev: number): number | null {
      if (prev <= 0) return null;
      return Math.round(((curr - prev) / prev) * 1000) / 10;  // % z 1 miejscem po przecinku
    }

    const totals = aggregateTotals(adRows);
    const prevTotals = aggregateTotals(prevRows);

    const activeCreatives = new Set(adRows.map(r => r.creative_id).filter(Boolean)).size;

    const kpis = {
      spend: Math.round(totals.spend),
      conversions: totals.conversions,
      conversionValue: Math.round(totals.conversionValue),
      roas: totals.spend > 0 ? Math.round((totals.conversionValue / totals.spend) * 100) / 100 : 0,
      cpa: totals.conversions > 0 ? Math.round((totals.spend / totals.conversions) * 100) / 100 : 0,
      ctr: totals.impressions > 0 ? Math.round((totals.clicks / totals.impressions) * 10000) / 100 : 0,
      hookRate: totals.impressions > 0 ? Math.round((totals.videoPlay3s / totals.impressions) * 10000) / 100 : 0,
      activeCreatives,
    };

    // Delty vs poprzedni okres (do badge'ów ↑/↓ w Pulse)
    const prevRoas = prevTotals.spend > 0 ? prevTotals.conversionValue / prevTotals.spend : 0;
    const prevCpa = prevTotals.conversions > 0 ? prevTotals.spend / prevTotals.conversions : 0;
    const prevCtr = prevTotals.impressions > 0 ? (prevTotals.clicks / prevTotals.impressions) * 100 : 0;
    const prevHookRate = prevTotals.impressions > 0 ? (prevTotals.videoPlay3s / prevTotals.impressions) * 100 : 0;
    const kpiDeltas = {
      spend: delta(totals.spend, prevTotals.spend),
      conversions: delta(totals.conversions, prevTotals.conversions),
      conversionValue: delta(totals.conversionValue, prevTotals.conversionValue),
      roas: delta(totals.spend > 0 ? totals.conversionValue / totals.spend : 0, prevRoas),
      cpa: delta(totals.conversions > 0 ? totals.spend / totals.conversions : 0, prevCpa),
      ctr: delta(totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0, prevCtr),
      hookRate: delta(totals.impressions > 0 ? (totals.videoPlay3s / totals.impressions) * 100 : 0, prevHookRate),
      periodLabel: `${prevDateFrom} → ${prevDateTo}`,
    };

    // Agregacja per creative_id
    type CreativeAgg = {
      creative_id: string;
      spend: number;
      impressions: number;
      clicks: number;
      conversions: number;
      conversion_value: number;
      video_play_3s: number;
      video_p25: number;
      video_p50: number;
      video_p75: number;
      video_p95: number;
      video_p100: number;
      thruplays: number;
    };
    const byCreative = new Map<string, CreativeAgg>();
    for (const r of adRows) {
      const cid = r.creative_id as string | null;
      if (!cid) continue;
      const cur = byCreative.get(cid) || {
        creative_id: cid, spend: 0, impressions: 0, clicks: 0,
        conversions: 0, conversion_value: 0, video_play_3s: 0,
        video_p25: 0, video_p50: 0, video_p75: 0, video_p95: 0, video_p100: 0, thruplays: 0,
      };
      cur.spend += Number(r.spend) || 0;
      cur.impressions += Number(r.impressions) || 0;
      cur.clicks += Number(r.clicks) || 0;
      cur.conversions += Number(r.conversions) || 0;
      cur.conversion_value += Number(r.conversion_value) || 0;
      cur.video_play_3s += Number(r.video_play_3s) || 0;
      cur.video_p25 += Number(r.video_p25_watched) || 0;
      cur.video_p50 += Number(r.video_p50_watched) || 0;
      cur.video_p75 += Number(r.video_p75_watched) || 0;
      cur.video_p95 += Number(r.video_p95_watched) || 0;
      cur.video_p100 += Number(r.video_p100_watched) || 0;
      cur.thruplays += Number(r.thruplays) || 0;
      byCreative.set(cid, cur);
    }

    // Build byCreative też dla poprzedniego okresu — do klasyfikacji
    // (scalable/burning/stable) musimy porównać CTR i ROAS WoW per kreacja.
    const byCreativePrev = new Map<string, CreativeAgg>();
    for (const r of prevRows) {
      const cid = r.creative_id as string | null;
      if (!cid) continue;
      const cur = byCreativePrev.get(cid) || {
        creative_id: cid, spend: 0, impressions: 0, clicks: 0,
        conversions: 0, conversion_value: 0, video_play_3s: 0,
        video_p25: 0, video_p50: 0, video_p75: 0, video_p95: 0, video_p100: 0, thruplays: 0,
      };
      cur.spend += Number(r.spend) || 0;
      cur.impressions += Number(r.impressions) || 0;
      cur.clicks += Number(r.clicks) || 0;
      cur.conversions += Number(r.conversions) || 0;
      cur.conversion_value += Number(r.conversion_value) || 0;
      byCreativePrev.set(cid, cur);
    }

    // Wszystkie kreacje aktywne w okresie (min 50 zł żeby odciąć kompletny szum,
    // ale zostawić więcej niż top 24 — bo Library powinno mieć też mniejsze)
    const allCreatives = Array.from(byCreative.values())
      .filter(c => c.spend > 30)
      .sort((a, b) => b.spend - a.spend);

    const topIds = allCreatives.map(c => c.creative_id);
    const metaRes = topIds.length > 0
      ? await db.from('dim_creatives')
          .select('creative_id, title, body, thumbnail_url, image_url, permalink_url, format, ai_tags, ai_insights, first_seen_at, account_id, video_id')
          .in('creative_id', topIds)
      : { data: [] };
    const metaMap = new Map(
      (metaRes.data || []).map((m) => [m.creative_id as string, m as Record<string, unknown>])
    );

    const NOW = Date.now();
    type EnrichedCreative = ReturnType<typeof enrich>;
    function enrich(c: CreativeAgg) {
      const m = metaMap.get(c.creative_id) || {};
      const insights = m.ai_insights as Record<string, unknown> | null | undefined;
      const videoViews = c.video_play_3s || 0;
      const prev = byCreativePrev.get(c.creative_id);
      const ctrCurr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
      const ctrPrev = prev && prev.impressions > 0 ? (prev.clicks / prev.impressions) * 100 : 0;
      const roasCurr = c.spend > 0 ? c.conversion_value / c.spend : 0;
      const roasPrev = prev && prev.spend > 0 ? prev.conversion_value / prev.spend : 0;
      const ctrDelta = ctrPrev > 0 ? Math.round(((ctrCurr - ctrPrev) / ctrPrev) * 1000) / 10 : null;
      const roasDelta = roasPrev > 0 ? Math.round(((roasCurr - roasPrev) / roasPrev) * 1000) / 10 : null;
      const spendDelta = prev && prev.spend > 0 ? Math.round(((c.spend - prev.spend) / prev.spend) * 1000) / 10 : null;
      const firstSeenAt = m.first_seen_at as string | null;
      const ageDays = firstSeenAt ? Math.floor((NOW - new Date(firstSeenAt).getTime()) / 86_400_000) : null;
      return {
        creative_id: c.creative_id,
        title: (m.title as string) || null,
        body: (m.body as string) || null,
        thumbnail_url: (m.thumbnail_url as string) || null,
        image_url: (m.image_url as string) || null,
        permalink_url: (m.permalink_url as string) || null,
        video_id: (m.video_id as string) || null,
        format: (m.format as string) || 'unknown',
        ai_tags: (m.ai_tags as string[]) || [],
        ai_insights: insights || null,
        first_seen_at: firstSeenAt,
        age_days: ageDays,
        account_id: (m.account_id as string) || null,
        spend: Math.round(c.spend),
        impressions: c.impressions,
        clicks: c.clicks,
        conversions: c.conversions,
        conversion_value: Math.round(c.conversion_value),
        roas: Math.round(roasCurr * 100) / 100,
        ctr: Math.round(ctrCurr * 100) / 100,
        hook_rate: c.impressions > 0 ? Math.round((c.video_play_3s / c.impressions) * 10000) / 100 : 0,
        cpa: c.conversions > 0 ? Math.round((c.spend / c.conversions) * 100) / 100 : 0,
        ctr_delta: ctrDelta,
        roas_delta: roasDelta,
        spend_delta: spendDelta,
        video_retention: videoViews > 0 ? {
          p25: Math.round((c.video_p25 / videoViews) * 1000) / 10,
          p50: Math.round((c.video_p50 / videoViews) * 1000) / 10,
          p75: Math.round((c.video_p75 / videoViews) * 1000) / 10,
          p95: Math.round((c.video_p95 / videoViews) * 1000) / 10,
          p100: Math.round((c.video_p100 / videoViews) * 1000) / 10,
        } : null,
      };
    }

    const enrichedAll = allCreatives.map(enrich);
    const topCreatives = enrichedAll.slice(0, 24);

    // Klasyfikacja kreacji do segmentów. Każda kreacja idzie do JEDNEGO segmentu
    // (priorytet: burning > scalable > stable > fresh).
    // Reguły dla zespołu mybed.pl/de — można dostroić po feedbacku.
    const buckets: {
      scalable: EnrichedCreative[];
      burning: EnrichedCreative[];
      fresh: EnrichedCreative[];
      stable: EnrichedCreative[];
    } = { scalable: [], burning: [], fresh: [], stable: [] };

    for (const c of enrichedAll) {
      const isFresh = c.age_days !== null && c.age_days <= 14;

      // BURNING — CTR spadł >25% WoW przy spendzie >150 zł i wieku >7d
      if (c.ctr_delta !== null && c.ctr_delta < -25 && c.spend > 150 && (c.age_days ?? 0) > 7) {
        buckets.burning.push(c);
        continue;
      }
      // SCALABLE — ROAS ≥3, spend stabilny lub rosnący, dojrzała (>7d)
      if (c.roas >= 3 && c.spend > 200 && (c.age_days ?? 0) > 7
          && (c.spend_delta === null || c.spend_delta >= -10)) {
        buckets.scalable.push(c);
        continue;
      }
      // STABLE — ROAS ≥2, dojrzała >30d, bez znaczących wahań CTR
      if (c.roas >= 2 && (c.age_days ?? 0) >= 30
          && (c.ctr_delta === null || Math.abs(c.ctr_delta) < 20)) {
        buckets.stable.push(c);
        continue;
      }
      // FRESH — niezależnie od wyników, młoda kreacja na watch list
      if (isFresh) {
        buckets.fresh.push(c);
        continue;
      }
      // Reszta nie trafia do żadnego segmentu — pokażemy w "Wszystkie kreacje"
    }

    // Sort buckets — scalable wg ROAS DESC, burning wg ctr_delta ASC (najgorsze najpierw)
    buckets.scalable.sort((a, b) => b.roas - a.roas);
    buckets.burning.sort((a, b) => (a.ctr_delta ?? 0) - (b.ctr_delta ?? 0));
    buckets.fresh.sort((a, b) => (b.spend) - (a.spend));
    buckets.stable.sort((a, b) => b.roas - a.roas);

    // Limit per bucket — 12 sztuk wystarcza, reszta dostępna w pełnej Library
    const trimBucket = (arr: EnrichedCreative[]) => arr.slice(0, 12);
    const creativeBuckets = {
      scalable: trimBucket(buckets.scalable),
      burning: trimBucket(buckets.burning),
      fresh: trimBucket(buckets.fresh),
      stable: trimBucket(buckets.stable),
    };

    // Pulse winners/losers — top 5 po roas_delta (winners) i ctr_delta (losers)
    const winners = [...enrichedAll]
      .filter(c => c.roas_delta !== null && c.spend > 100)
      .sort((a, b) => (b.roas_delta ?? 0) - (a.roas_delta ?? 0))
      .slice(0, 5);
    const losers = [...enrichedAll]
      .filter(c => c.ctr_delta !== null && c.spend > 100)
      .sort((a, b) => (a.ctr_delta ?? 0) - (b.ctr_delta ?? 0))
      .slice(0, 5);
    const freshWatch = [...enrichedAll]
      .filter(c => c.age_days !== null && c.age_days <= 7)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5);

    // Recently launched — kreacje z pierwszym pokazaniem w ostatnich 14 dniach
    // FILTRUJE po account_id tak samo jak fact query, żeby przełącznik sklepu działał.
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    let recentQuery = db
      .from('dim_creatives')
      .select('creative_id, title, body, thumbnail_url, image_url, permalink_url, format, first_seen_at, ai_tags, ai_insights, account_id, video_id')
      .gte('first_seen_at', fourteenDaysAgo.toISOString())
      .order('first_seen_at', { ascending: false })
      .limit(12);
    if (accountIdFilter) recentQuery = recentQuery.eq('account_id', accountIdFilter);
    const { data: recent } = await recentQuery;

    const recentlyLaunched = (recent || []).map(r => {
      const c = byCreative.get(r.creative_id as string);
      const insights = r.ai_insights as Record<string, unknown> | null | undefined;
      const videoViews = c?.video_play_3s || 0;
      return {
        creative_id: r.creative_id,
        title: r.title,
        body: r.body,
        thumbnail_url: r.thumbnail_url,
        image_url: r.image_url,
        permalink_url: r.permalink_url,
        video_id: r.video_id,
        format: r.format,
        first_seen_at: r.first_seen_at,
        ai_tags: r.ai_tags || [],
        ai_insights: insights || null,
        account_id: r.account_id,
        spend: c ? Math.round(c.spend) : 0,
        impressions: c?.impressions || 0,
        clicks: c?.clicks || 0,
        conversions: c?.conversions || 0,
        conversion_value: c ? Math.round(c.conversion_value) : 0,
        roas: c && c.spend > 0 ? Math.round((c.conversion_value / c.spend) * 100) / 100 : 0,
        ctr: c && c.impressions > 0 ? Math.round((c.clicks / c.impressions) * 10000) / 100 : 0,
        hook_rate: c && c.impressions > 0 ? Math.round((c.video_play_3s / c.impressions) * 10000) / 100 : 0,
        cpa: c && c.conversions > 0 ? Math.round((c.spend / c.conversions) * 100) / 100 : 0,
        video_retention: c && videoViews > 0 ? {
          p25: Math.round((c.video_p25 / videoViews) * 1000) / 10,
          p50: Math.round((c.video_p50 / videoViews) * 1000) / 10,
          p75: Math.round((c.video_p75 / videoViews) * 1000) / 10,
          p95: Math.round((c.video_p95 / videoViews) * 1000) / 10,
          p100: Math.round((c.video_p100 / videoViews) * 1000) / 10,
        } : null,
      };
    });

    // Coverage + last sync + tag counts
    const [minRes, maxRes, countRes, lastSyncRes, taggedRes, pendingRes, failedRes] = await Promise.all([
      db.from('fact_daily_ad_performance').select('date').order('date', { ascending: true }).limit(1).maybeSingle(),
      db.from('fact_daily_ad_performance').select('date').order('date', { ascending: false }).limit(1).maybeSingle(),
      db.from('fact_daily_ad_performance').select('*', { count: 'exact', head: true }),
      db.from('etl_log').select('finished_at, rows_processed')
        .eq('source', 'meta_ads_adlevel').eq('status', 'success')
        .order('finished_at', { ascending: false }).limit(1).maybeSingle(),
      db.from('dim_creatives').select('*', { count: 'exact', head: true }).eq('ai_tag_status', 'completed'),
      db.from('dim_creatives').select('*', { count: 'exact', head: true }).eq('ai_tag_status', 'pending'),
      db.from('dim_creatives').select('*', { count: 'exact', head: true }).eq('ai_tag_status', 'failed'),
    ]);
    const coverage = minRes.data && maxRes.data ? {
      from: minRes.data.date as string,
      to: maxRes.data.date as string,
      rows: countRes.count ?? 0,
    } : null;

    // Level-based agregacje — campaign i adset.
    // Creative level pozostaje w topCreatives / recentlyLaunched (bez zmian back-compat).
    let campaigns: ReturnType<typeof aggRow>[] | null = null;
    let adsets: ReturnType<typeof aggRow>[] | null = null;
    if (level === 'campaign') {
      const campaignMap = buildLevelMap(adRows, 'campaign_id');
      campaigns = Array.from(campaignMap.values())
        .map(aggRow)
        .sort((a, b) => b.spend - a.spend);
    } else if (level === 'adset') {
      const adsetMap = buildLevelMap(adRows, 'adset_id');
      adsets = Array.from(adsetMap.values())
        .map(aggRow)
        .sort((a, b) => b.spend - a.spend);
    }

    // Kontekst filtra — jeśli jest ?campaign_id lub ?adset_id, rozkoduj nazwy
    // żeby UI mogło pokazać breadcrumb.
    const filterContext = {
      campaign: campaignId ? {
        id: campaignId,
        name: adRows.find(r => r.campaign_id === campaignId)?.campaign_name as string || campaignId,
      } : null,
      adset: adsetId ? {
        id: adsetId,
        name: adRows.find(r => r.adset_id === adsetId)?.adset_name as string || adsetId,
        campaign_id: adRows.find(r => r.adset_id === adsetId)?.campaign_id as string || null,
        campaign_name: adRows.find(r => r.adset_id === adsetId)?.campaign_name as string || null,
      } : null,
    };

    return NextResponse.json({
      level,
      kpis,
      kpiDeltas,
      topCreatives,
      recentlyLaunched,
      creativeBuckets,
      pulse: { winners, losers, freshWatch },
      campaigns,
      adsets,
      filterContext,
      coverage,
      tagging: {
        completed: taggedRes.count ?? 0,
        pending: pendingRes.count ?? 0,
        failed: failedRes.count ?? 0,
      },
      lastSync: lastSyncRes.data
        ? { at: lastSyncRes.data.finished_at, rows: lastSyncRes.data.rows_processed }
        : null,
    });
  } catch (err) {
    console.error('Meta dashboard API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
