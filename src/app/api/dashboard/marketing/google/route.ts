import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchEurRatesByDate, gaToPln } from '@/lib/ad-cost';
import { applyShopFilter } from '@/lib/shop-filter';

// Google Ads w GA4 ma DWA tryby raportowania advertiserAdCost:
//   1) source='__total__' — dzienna suma per host. To samo, co Looker pokazuje
//      jako „Google Ads total" i co używa widget kpi_google_spend na dashboardzie.
//   2) source='google' AND medium='cpc' — per-kampania. GA4 NIE przypisuje wszystkich
//      kliknięć do konkretnych kampanii (np. UAC, kampanie z błędnym taggingiem),
//      więc SUMA per-kampania jest typowo o ~5-10% mniejsza niż __total__.
//
// Headline KPIs (Total Spend, Revenue, ROAS, daily charts) → __total__ (zgodność z widgetem).
// Tabela kampanii → per-kampania (jedyne źródło breakdownów).
// Waluta: mybed.de jest w EUR — konwertujemy gaToPln dziennymi kursami z fact_orders.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from') || '2025-01-01';
    const dateTo = searchParams.get('date_to') || new Date().toISOString().split('T')[0];
    const shop = searchParams.get('shop') || 'all';

    const db = getSupabaseAdmin();

    const PAGE_SIZE = 1000;
    async function fetchAll(filterFn: (q: ReturnType<typeof db.from>) => unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out: any[] = [];
      let offset = 0;
      while (true) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q: any = db
          .from('fact_daily_traffic')
          .select('date, hostname, campaign, sessions, transactions, ga_revenue, ad_cost, ad_clicks, ad_impressions')
          .gte('date', dateFrom).lte('date', dateTo)
          .order('date', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        q = filterFn(q) ?? q;
        const { data: page, error } = await q;
        if (error) throw new Error(error.message);
        if (!page || page.length === 0) break;
        out.push(...page);
        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      return out;
    }

    // 1) __total__ — headline KPIs, daily charts, per-host breakdown
    const totalRows = await fetchAll(q => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let qq = (q as any).eq('source', '__total__');
      qq = applyShopFilter(qq, shop, 'hostname');
      return qq;
    });

    // 2) per-kampania — tabela kampanii i top by ROAS
    const campRows = await fetchAll(q => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let qq = (q as any).eq('source', 'google').eq('medium', 'cpc');
      qq = applyShopFilter(qq, shop, 'hostname');
      return qq;
    });

    const eurRates = await fetchEurRatesByDate(db, dateFrom, dateTo);

    // Normalizacja __total__ z konwersją EUR→PLN dla mybed.de
    const totalNorm = totalRows.map(r => ({
      date: String(r.date),
      hostname: String(r.hostname || ''),
      sessions: Number(r.sessions) || 0,
      transactions: Number(r.transactions) || 0,
      clicks: Number(r.ad_clicks) || 0,
      impressions: Number(r.ad_impressions) || 0,
      spend: gaToPln(r.hostname, Number(r.ad_cost) || 0, String(r.date), eurRates),
      revenue: gaToPln(r.hostname, Number(r.ga_revenue) || 0, String(r.date), eurRates),
    }));

    // Normalizacja per-kampania (PLN po konwersji)
    const campNorm = campRows.map(r => ({
      date: String(r.date),
      hostname: String(r.hostname || ''),
      campaign: String(r.campaign || '(unknown)'),
      sessions: Number(r.sessions) || 0,
      transactions: Number(r.transactions) || 0,
      clicks: Number(r.ad_clicks) || 0,
      impressions: Number(r.ad_impressions) || 0,
      spend: gaToPln(r.hostname, Number(r.ad_cost) || 0, String(r.date), eurRates),
      revenue: gaToPln(r.hostname, Number(r.ga_revenue) || 0, String(r.date), eurRates),
    }));

    // KPIs:
    //   COST side (spend/clicks/impressions/CPC/CPM/CTR) z __total__ — bo ad_cost
    //     w GA4 jest atrybutywne tylko sesyjnie, ale w __total__ (bez dimensji)
    //     dostajemy pełną kwotę z linka Google Ads.
    //   REVENUE side (revenue/trans/sessions/ROAS/convRate) z google/cpc —
    //     __total__ to revenue WSZYSTKICH źródeł (organic, direct, email, etc.),
    //     a my chcemy revenue atrybuowany do kampanii Google Ads.
    const costTotals = totalNorm.reduce(
      (a, r) => {
        a.spend += r.spend;
        a.clicks += r.clicks;
        a.impressions += r.impressions;
        return a;
      },
      { spend: 0, clicks: 0, impressions: 0 },
    );
    const revTotals = campNorm.reduce(
      (a, r) => {
        a.revenue += r.revenue;
        a.transactions += r.transactions;
        a.sessions += r.sessions;
        return a;
      },
      { revenue: 0, transactions: 0, sessions: 0 },
    );
    const blendedRoas = costTotals.spend > 0 ? revTotals.revenue / costTotals.spend : 0;
    const avgCpc = costTotals.clicks > 0 ? costTotals.spend / costTotals.clicks : 0;
    const avgCpm = costTotals.impressions > 0 ? (costTotals.spend / costTotals.impressions) * 1000 : 0;
    const avgCtr = costTotals.impressions > 0 ? (costTotals.clicks / costTotals.impressions) * 100 : 0;
    const convRate = revTotals.sessions > 0 ? (revTotals.transactions / revTotals.sessions) * 100 : 0;

    // Spend vs Revenue per dzień — spend z __total__, revenue z google/cpc
    const dailyMap: Record<string, { spend: number; revenue: number }> = {};
    for (const r of totalNorm) {
      if (!dailyMap[r.date]) dailyMap[r.date] = { spend: 0, revenue: 0 };
      dailyMap[r.date].spend += r.spend;
    }
    for (const r of campNorm) {
      if (!dailyMap[r.date]) dailyMap[r.date] = { spend: 0, revenue: 0 };
      dailyMap[r.date].revenue += r.revenue;
    }
    const spendVsRevenue = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, spend: Math.round(v.spend), revenue: Math.round(v.revenue) }));

    const roasTrend = spendVsRevenue.map(d => ({
      name: d.date,
      value: d.spend > 0 ? Math.round((d.revenue / d.spend) * 100) / 100 : 0,
    }));

    // Spend per sklep — z __total__
    const byShop: Record<string, number> = {};
    for (const r of totalNorm) byShop[r.hostname] = (byShop[r.hostname] || 0) + r.spend;
    const spendByShop = Object.entries(byShop)
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value);

    // Tabela kampanii — z per-kampania (jedyne źródło)
    const campaignMap: Record<string, {
      campaign: string; hostname: string;
      spend: number; revenue: number; clicks: number; impressions: number;
      transactions: number; sessions: number;
    }> = {};
    for (const r of campNorm) {
      const key = `${r.hostname}::${r.campaign}`;
      if (!campaignMap[key]) {
        campaignMap[key] = {
          campaign: r.campaign, hostname: r.hostname,
          spend: 0, revenue: 0, clicks: 0, impressions: 0, transactions: 0, sessions: 0,
        };
      }
      const c = campaignMap[key];
      c.spend += r.spend;
      c.revenue += r.revenue;
      c.clicks += r.clicks;
      c.impressions += r.impressions;
      c.transactions += r.transactions;
      c.sessions += r.sessions;
    }
    const campaignTable = Object.values(campaignMap)
      .map(c => ({
        campaign: c.campaign,
        hostname: c.hostname,
        spend: Math.round(c.spend),
        revenue: Math.round(c.revenue),
        clicks: c.clicks,
        impressions: c.impressions,
        transactions: c.transactions,
        sessions: c.sessions,
        ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
        cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
        roas: c.spend > 0 ? c.revenue / c.spend : 0,
      }))
      .sort((a, b) => b.spend - a.spend);

    // Suma per-kampania — żeby frontend mógł pokazać gap vs Total Spend
    const campaignSumSpend = Math.round(campaignTable.reduce((s, c) => s + c.spend, 0));

    const topByRoas = [...campaignTable]
      .filter(c => c.spend > 100)
      .sort((a, b) => b.roas - a.roas)
      .slice(0, 10)
      .map(c => ({ name: c.campaign, value: Math.round(c.roas * 100) / 100 }));

    // Coverage — bazujemy na __total__ (to definiuje obecność danych Google Ads)
    const [minRes, maxRes, countRes] = await Promise.all([
      db.from('fact_daily_traffic').select('date').eq('source', '__total__')
        .order('date', { ascending: true }).limit(1).maybeSingle(),
      db.from('fact_daily_traffic').select('date').eq('source', '__total__')
        .order('date', { ascending: false }).limit(1).maybeSingle(),
      db.from('fact_daily_traffic').select('*', { count: 'exact', head: true })
        .eq('source', '__total__'),
    ]);
    const coverage = minRes.data && maxRes.data
      ? { from: minRes.data.date as string, to: maxRes.data.date as string, rows: countRes.count ?? 0 }
      : null;

    const { data: lastSyncRow } = await db
      .from('etl_log')
      .select('finished_at, rows_processed')
      .eq('source', 'ga4')
      .eq('status', 'success')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      kpis: {
        totalSpend: Math.round(costTotals.spend),
        totalRevenue: Math.round(revTotals.revenue),
        totalTransactions: revTotals.transactions,
        totalSessions: revTotals.sessions,
        totalClicks: costTotals.clicks,
        blendedRoas: Math.round(blendedRoas * 100) / 100,
        avgCpc: Math.round(avgCpc * 100) / 100,
        avgCpm: Math.round(avgCpm * 100) / 100,
        avgCtr: Math.round(avgCtr * 100) / 100,
        convRate: Math.round(convRate * 100) / 100,
      },
      charts: { spendVsRevenue, roasTrend, spendByShop, topByRoas },
      campaignTable,
      campaignSumSpend,
      coverage,
      lastSync: lastSyncRow ? { at: lastSyncRow.finished_at, rows: lastSyncRow.rows_processed } : null,
    });
  } catch (err) {
    console.error('Marketing/google API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
