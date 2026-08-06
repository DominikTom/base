import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { previousPeriod, pctChange } from '@/lib/period-compare';
import {
  fetchAdPerfRows, shopFilterToAccountIds,
  aggregateAccounts, aggregateCampaigns, aggregateAdsets, aggregateAds,
  emptyTotals, addRow, finalizeTotals,
  type FinalizedMetrics,
} from '@/lib/marketing-ads';

// GET /api/dashboard/marketing/ads?date_from&date_to&shop
//
// Jeden endpoint dla zakładek Kampanie / Zestawy / Kreacje: agregacje
// ad-level per konto (z deltą okres-do-okresu), kampania (join dim_campaigns:
// objective + pola manualne), zestaw i reklama (join dim_creatives: format,
// miniatura, video_id do podglądu). Wszystkie okna atrybucji w każdej pozycji.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from') || '2025-01-01';
    const dateTo = searchParams.get('date_to') || new Date().toISOString().split('T')[0];
    const shop = searchParams.get('shop') || 'all';
    // Multi-select sklepów: filters.shop bywa CSV ('mybed.pl,mybed.de')
    const accountFilter = shopFilterToAccountIds(shop);

    const prev = previousPeriod(dateFrom, dateTo);
    const [rows, prevRows] = await Promise.all([
      fetchAdPerfRows(dateFrom, dateTo, accountFilter),
      fetchAdPerfRows(prev.from, prev.to, accountFilter),
    ]);

    const db = getSupabaseAdmin();

    // Coverage ad-level (niezależnie od filtra dat — pokazuje co jest w bazie)
    const [minRes, maxRes, countRes] = await Promise.all([
      db.from('fact_daily_ad_performance').select('date').eq('platform', 'meta')
        .order('date', { ascending: true }).limit(1).maybeSingle(),
      db.from('fact_daily_ad_performance').select('date').eq('platform', 'meta')
        .order('date', { ascending: false }).limit(1).maybeSingle(),
      db.from('fact_daily_ad_performance').select('*', { count: 'exact', head: true })
        .eq('platform', 'meta'),
    ]);
    const coverage = minRes.data && maxRes.data
      ? { from: minRes.data.date as string, to: maxRes.data.date as string, rows: countRes.count ?? 0 }
      : null;

    // Totals + delta PoP
    const curTotals = emptyTotals();
    rows.forEach(r => addRow(curTotals, r));
    const prevTotals = emptyTotals();
    prevRows.forEach(r => addRow(prevTotals, r));
    const cur = finalizeTotals(curTotals);
    const prv = finalizeTotals(prevTotals);

    const deltasOf = (c: FinalizedMetrics, p: FinalizedMetrics) => ({
      spend: pctChange(c.spend, p.spend),
      revenue: pctChange(c.revenue, p.revenue),
      roas: pctChange(c.roas, p.roas),
      purchases: pctChange(c.purchases, p.purchases),
      leads: pctChange(c.leads, p.leads),
      reach: pctChange(c.reach, p.reach),
      cpm: pctChange(c.cpm, p.cpm),
      ctr: pctChange(c.ctr, p.ctr),
      cpl: pctChange(c.cpl, p.cpl),
    });

    // Konta z deltami PoP
    const accounts = aggregateAccounts(rows);
    const prevAccounts = new Map(aggregateAccounts(prevRows).map(a => [a.accountId, a]));
    const accountsOut = accounts.map(a => {
      const p = prevAccounts.get(a.accountId);
      return { ...a, deltas: p ? deltasOf(a, p) : null };
    });

    // Kampanie + join dim_campaigns
    const campaigns = aggregateCampaigns(rows);
    const campaignIds = campaigns.map(c => c.campaignId);
    const campaignMeta = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < campaignIds.length; i += 200) {
      const { data } = await db
        .from('dim_campaigns')
        .select('campaign_id, objective, status, effective_status, daily_budget, lifetime_budget, purpose, funnel_stage, notes')
        .in('campaign_id', campaignIds.slice(i, i + 200));
      for (const row of data || []) campaignMeta.set(row.campaign_id as string, row);
    }
    const campaignsOut = campaigns.map(c => {
      const m = campaignMeta.get(c.campaignId);
      return {
        ...c,
        objective: (m?.objective as string) || null,
        status: (m?.effective_status as string) || (m?.status as string) || null,
        dailyBudget: (m?.daily_budget as number) ?? null,
        purpose: (m?.purpose as string) || null,
        funnelStage: (m?.funnel_stage as string) || null,
        notes: (m?.notes as string) || null,
      };
    });

    const adsets = aggregateAdsets(rows);

    // Reklamy + join dim_creatives (miniatura, format, video do podglądu)
    const ads = aggregateAds(rows);
    const creativeIds = Array.from(new Set(ads.map(a => a.creativeId).filter((id): id is string => !!id)));
    const creativeMeta = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < creativeIds.length; i += 200) {
      const { data } = await db
        .from('dim_creatives')
        .select('creative_id, format, thumbnail_url, image_url, video_id, title, body, call_to_action_type, is_dynamic, auto_tags, ai_tags, manual_tags')
        .in('creative_id', creativeIds.slice(i, i + 200));
      for (const row of data || []) creativeMeta.set(row.creative_id as string, row);
    }
    const adsOut = ads.map(a => {
      const m = a.creativeId ? creativeMeta.get(a.creativeId) : undefined;
      return {
        ...a,
        creative: m ? {
          format: (m.format as string) || 'unknown',
          thumbnailUrl: (m.thumbnail_url as string) || null,
          imageUrl: (m.image_url as string) || null,
          videoId: (m.video_id as string) || null,
          title: (m.title as string) || null,
          body: (m.body as string) || null,
          callToActionType: (m.call_to_action_type as string) || null,
          isDynamic: !!m.is_dynamic,
          tags: Array.from(new Set([
            ...((m.auto_tags as string[]) || []),
            ...((m.ai_tags as string[]) || []),
            ...((m.manual_tags as string[]) || []),
          ])),
        } : null,
      };
    });

    return NextResponse.json({
      period: { from: dateFrom, to: dateTo },
      previous: prev,
      coverage,
      totals: { ...cur, deltas: deltasOf(cur, prv) },
      accounts: accountsOut,
      campaigns: campaignsOut,
      adsets,
      ads: adsOut,
    });
  } catch (err) {
    console.error('Marketing ads API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
