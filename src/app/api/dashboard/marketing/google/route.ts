import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchEurRatesByDate, gaToPln } from '@/lib/ad-cost';

// Google Ads w bazie żyje w fact_daily_traffic (z importu GA4). Per-kampania
// dane to wiersze source='google' AND medium='cpc' z populowanymi
// ad_cost / ad_clicks / ad_impressions oraz ga_revenue/transactions.
// Hostname = sklep (mybed.pl / mybed.de / mittohome.pl).
// UWAGA — waluta: dla mybed.de ad_cost i ga_revenue są w EUR (waluta property
// GA4); konwertujemy na PLN dziennymi kursami z fact_orders.exchange_rate.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from') || '2025-01-01';
    const dateTo = searchParams.get('date_to') || new Date().toISOString().split('T')[0];
    const shop = searchParams.get('shop') || 'all';

    const db = getSupabaseAdmin();

    // Paginowane pobranie per-kampania (PostgREST 1000-row default cap).
    const PAGE_SIZE = 1000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = [];
    let offset = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let q = db
        .from('fact_daily_traffic')
        .select('date, hostname, campaign, sessions, transactions, ga_revenue, ad_cost, ad_clicks, ad_impressions')
        .eq('source', 'google').eq('medium', 'cpc')
        .gte('date', dateFrom).lte('date', dateTo)
        .order('date', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (shop !== 'all') q = q.eq('hostname', shop);
      const { data: page, error } = await q;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!page || page.length === 0) break;
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    // Kursy EUR→PLN dla konwersji wierszy mybed.de.
    const eurRates = await fetchEurRatesByDate(db, dateFrom, dateTo);

    // Pre-pass: każdy wiersz konwertujemy raz; potem normalnie agregujemy.
    const norm = rows.map(r => ({
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

    // KPIs
    const totals = norm.reduce(
      (a, r) => {
        a.spend += r.spend;
        a.revenue += r.revenue;
        a.clicks += r.clicks;
        a.impressions += r.impressions;
        a.transactions += r.transactions;
        a.sessions += r.sessions;
        return a;
      },
      { spend: 0, revenue: 0, clicks: 0, impressions: 0, transactions: 0, sessions: 0 },
    );
    const blendedRoas = totals.spend > 0 ? totals.revenue / totals.spend : 0;
    const avgCpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
    const avgCpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
    const avgCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    const convRate = totals.sessions > 0 ? (totals.transactions / totals.sessions) * 100 : 0;

    // Spend vs Revenue per dzień
    const dailyMap: Record<string, { spend: number; revenue: number }> = {};
    for (const r of norm) {
      if (!dailyMap[r.date]) dailyMap[r.date] = { spend: 0, revenue: 0 };
      dailyMap[r.date].spend += r.spend;
      dailyMap[r.date].revenue += r.revenue;
    }
    const spendVsRevenue = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, spend: Math.round(v.spend), revenue: Math.round(v.revenue) }));

    // ROAS trend (per dzień)
    const roasTrend = spendVsRevenue.map(d => ({
      name: d.date,
      value: d.spend > 0 ? Math.round((d.revenue / d.spend) * 100) / 100 : 0,
    }));

    // Spend per sklep
    const byShop: Record<string, number> = {};
    for (const r of norm) byShop[r.hostname] = (byShop[r.hostname] || 0) + r.spend;
    const spendByShop = Object.entries(byShop)
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value);

    // Tabela kampanii (campaign × hostname)
    const campaignMap: Record<string, {
      campaign: string; hostname: string;
      spend: number; revenue: number; clicks: number; impressions: number;
      transactions: number; sessions: number;
    }> = {};
    for (const r of norm) {
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

    // Top 10 kampanii wg ROAS (z minimalnym spend, żeby nie wybijały singletony)
    const topByRoas = [...campaignTable]
      .filter(c => c.spend > 100)
      .sort((a, b) => b.roas - a.roas)
      .slice(0, 10)
      .map(c => ({ name: c.campaign, value: Math.round(c.roas * 100) / 100 }));

    // Coverage
    const [minRes, maxRes, countRes] = await Promise.all([
      db.from('fact_daily_traffic').select('date').eq('source', 'google').eq('medium', 'cpc')
        .order('date', { ascending: true }).limit(1).maybeSingle(),
      db.from('fact_daily_traffic').select('date').eq('source', 'google').eq('medium', 'cpc')
        .order('date', { ascending: false }).limit(1).maybeSingle(),
      db.from('fact_daily_traffic').select('*', { count: 'exact', head: true })
        .eq('source', 'google').eq('medium', 'cpc'),
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
        totalSpend: Math.round(totals.spend),
        totalRevenue: Math.round(totals.revenue),
        totalTransactions: totals.transactions,
        totalSessions: totals.sessions,
        totalClicks: totals.clicks,
        blendedRoas: Math.round(blendedRoas * 100) / 100,
        avgCpc: Math.round(avgCpc * 100) / 100,
        avgCpm: Math.round(avgCpm * 100) / 100,
        avgCtr: Math.round(avgCtr * 100) / 100,
        convRate: Math.round(convRate * 100) / 100,
      },
      charts: { spendVsRevenue, roasTrend, spendByShop, topByRoas },
      campaignTable,
      coverage,
      lastSync: lastSyncRow ? { at: lastSyncRow.finished_at, rows: lastSyncRow.rows_processed } : null,
    });
  } catch (err) {
    console.error('Marketing/google API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
