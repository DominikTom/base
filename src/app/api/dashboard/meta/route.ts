import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { SHOP_TO_META_ACCOUNT } from '@/lib/meta-ads';

// Paginated fetch — Supabase PostgREST ma default cap 1000.
async function fetchAllAdPerf(params: {
  dateFrom: string;
  dateTo: string;
  accountId: string | null;
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
    const { data, error } = await q;
    if (error) throw new Error(`fact_daily_ad_performance: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as Array<Record<string, unknown>>));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from') || '2025-01-01';
    const dateTo = searchParams.get('date_to') || new Date().toISOString().split('T')[0];
    const shop = searchParams.get('shop') || 'all';
    const accountIdFilter = shop === 'all' ? null : (SHOP_TO_META_ACCOUNT[shop] ?? 'NONE');

    const db = getSupabaseAdmin();

    const adRows = await fetchAllAdPerf({ dateFrom, dateTo, accountId: accountIdFilter });

    // KPIs — agregacja po wszystkich wierszach w zakresie
    const totals = { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, videoPlay3s: 0 };
    for (const r of adRows) {
      totals.spend += Number(r.spend) || 0;
      totals.impressions += Number(r.impressions) || 0;
      totals.clicks += Number(r.clicks) || 0;
      totals.conversions += Number(r.conversions) || 0;
      totals.conversionValue += Number(r.conversion_value) || 0;
      totals.videoPlay3s += Number(r.video_play_3s) || 0;
    }

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

    // Agregacja per creative_id
    type CreativeAgg = {
      creative_id: string;
      spend: number;
      impressions: number;
      clicks: number;
      conversions: number;
      conversion_value: number;
      video_play_3s: number;
    };
    const byCreative = new Map<string, CreativeAgg>();
    for (const r of adRows) {
      const cid = r.creative_id as string | null;
      if (!cid) continue;
      const cur = byCreative.get(cid) || {
        creative_id: cid, spend: 0, impressions: 0, clicks: 0,
        conversions: 0, conversion_value: 0, video_play_3s: 0,
      };
      cur.spend += Number(r.spend) || 0;
      cur.impressions += Number(r.impressions) || 0;
      cur.clicks += Number(r.clicks) || 0;
      cur.conversions += Number(r.conversions) || 0;
      cur.conversion_value += Number(r.conversion_value) || 0;
      cur.video_play_3s += Number(r.video_play_3s) || 0;
      byCreative.set(cid, cur);
    }

    // Top 24 creatives by spend (min spend > 50 PLN żeby odciąć szum)
    const topByCrea = Array.from(byCreative.values())
      .filter(c => c.spend > 50)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 24);

    // Pobierz metadane dla top creatives jednym zapytaniem
    const topIds = topByCrea.map(c => c.creative_id);
    const metaRes = topIds.length > 0
      ? await db.from('dim_creatives')
          .select('creative_id, title, body, thumbnail_url, format, ai_tags, ai_insights, first_seen_at, account_id')
          .in('creative_id', topIds)
      : { data: [] };
    const metaMap = new Map(
      (metaRes.data || []).map((m) => [m.creative_id as string, m as Record<string, unknown>])
    );

    const topCreatives = topByCrea.map(c => {
      const m = metaMap.get(c.creative_id) || {};
      const insights = m.ai_insights as Record<string, unknown> | undefined;
      return {
        creative_id: c.creative_id,
        title: (m.title as string) || null,
        thumbnail_url: (m.thumbnail_url as string) || null,
        format: (m.format as string) || 'unknown',
        ai_tags: (m.ai_tags as string[]) || [],
        ai_rationale: (insights?.rationale as string) || null,
        first_seen_at: (m.first_seen_at as string) || null,
        account_id: (m.account_id as string) || null,
        spend: Math.round(c.spend),
        impressions: c.impressions,
        clicks: c.clicks,
        conversions: c.conversions,
        conversion_value: Math.round(c.conversion_value),
        roas: c.spend > 0 ? Math.round((c.conversion_value / c.spend) * 100) / 100 : 0,
        ctr: c.impressions > 0 ? Math.round((c.clicks / c.impressions) * 10000) / 100 : 0,
        hook_rate: c.impressions > 0 ? Math.round((c.video_play_3s / c.impressions) * 10000) / 100 : 0,
        cpa: c.conversions > 0 ? Math.round((c.spend / c.conversions) * 100) / 100 : 0,
      };
    });

    // Recently launched — kreacje z pierwszym pokazaniem w ostatnich 14 dniach
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const { data: recent } = await db
      .from('dim_creatives')
      .select('creative_id, title, thumbnail_url, format, first_seen_at, ai_tags, account_id')
      .gte('first_seen_at', fourteenDaysAgo.toISOString())
      .order('first_seen_at', { ascending: false })
      .limit(12);

    const recentlyLaunched = (recent || []).map(r => {
      const c = byCreative.get(r.creative_id as string);
      return {
        creative_id: r.creative_id,
        title: r.title,
        thumbnail_url: r.thumbnail_url,
        format: r.format,
        first_seen_at: r.first_seen_at,
        ai_tags: r.ai_tags || [],
        account_id: r.account_id,
        spend: c ? Math.round(c.spend) : 0,
        impressions: c?.impressions || 0,
        clicks: c?.clicks || 0,
        conversions: c?.conversions || 0,
        roas: c && c.spend > 0 ? Math.round((c.conversion_value / c.spend) * 100) / 100 : 0,
        ctr: c && c.impressions > 0 ? Math.round((c.clicks / c.impressions) * 10000) / 100 : 0,
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

    return NextResponse.json({
      kpis,
      topCreatives,
      recentlyLaunched,
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
