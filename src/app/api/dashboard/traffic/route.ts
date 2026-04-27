import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchAllPaginated } from '@/lib/db-pagination';

type TrafficRow = {
  date: string;
  source: string;
  medium: string;
  hostname: string;
  sessions: number | null;
  users: number | null;
  new_users: number | null;
  pageviews: number | null;
  transactions: number | null;
  ga_revenue: number | null;
  ad_cost: number | null;
  ad_clicks: number | null;
  ad_impressions: number | null;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from') || '2025-01-01';
    const dateTo = searchParams.get('date_to') || new Date().toISOString().split('T')[0];
    const hostname = searchParams.get('hostname') || 'all';

    let trafficData: TrafficRow[] = [];
    try {
      trafficData = await fetchAllPaginated<TrafficRow>(() => {
        let q = getSupabaseAdmin()
          .from('fact_daily_traffic')
          .select('*')
          .gte('date', dateFrom)
          .lte('date', dateTo)
          .order('date', { ascending: true });
        if (hostname !== 'all') q = q.eq('hostname', hostname);
        return q;
      });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }

    // KPIs from __total__ rows (accurate, matches GA4 native)
    const allRows = trafficData;
    const totalRows = allRows.filter(r => r.source === '__total__');
    const detailRows = allRows.filter(r => r.source !== '__total__');

    const totals = totalRows.reduce(
      (acc, row) => {
        acc.sessions += row.sessions || 0;
        acc.users += row.users || 0;
        acc.newUsers += row.new_users || 0;
        acc.pageviews += row.pageviews || 0;
        acc.transactions += row.transactions || 0;
        acc.revenue += row.ga_revenue || 0;
        acc.adCost += row.ad_cost || 0;
        acc.adClicks += row.ad_clicks || 0;
        acc.adImpressions += row.ad_impressions || 0;
        return acc;
      },
      { sessions: 0, users: 0, newUsers: 0, pageviews: 0, transactions: 0, revenue: 0, adCost: 0, adClicks: 0, adImpressions: 0 }
    );

    const conversionRate = totals.sessions > 0 ? (totals.transactions / totals.sessions) * 100 : 0;

    // Sessions over time by hostname (from __total__ rows for accuracy)
    const sessionsMap: Record<string, Record<string, number>> = {};
    const hostnames = new Set<string>();
    for (const row of totalRows) {
      if (!sessionsMap[row.date]) sessionsMap[row.date] = {};
      sessionsMap[row.date][row.hostname] = (sessionsMap[row.date][row.hostname] || 0) + (row.sessions || 0);
      hostnames.add(row.hostname);
    }
    const sessionsTimeSeries = Object.entries(sessionsMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({ date, ...values }));

    // Source/Medium breakdown
    const sourceMap: Record<string, { sessions: number; transactions: number; revenue: number }> = {};
    for (const row of detailRows) {
      const key = `${row.source} / ${row.medium}`;
      if (!sourceMap[key]) sourceMap[key] = { sessions: 0, transactions: 0, revenue: 0 };
      sourceMap[key].sessions += row.sessions || 0;
      sourceMap[key].transactions += row.transactions || 0;
      sourceMap[key].revenue += row.ga_revenue || 0;
    }
    const sourceTable = Object.entries(sourceMap)
      .sort(([, a], [, b]) => b.sessions - a.sessions)
      .slice(0, 20)
      .map(([source, v]) => ({
        source,
        sessions: v.sessions,
        transactions: v.transactions,
        revenue: Math.round(v.revenue),
        conversionRate: v.sessions > 0 ? Math.round((v.transactions / v.sessions) * 10000) / 100 : 0,
      }));

    // Source breakdown for pie chart
    const sourcePie = Object.entries(sourceMap)
      .sort(([, a], [, b]) => b.sessions - a.sessions)
      .slice(0, 8)
      .map(([name, v]) => ({ name, value: v.sessions }));

    // Daily ad cost chart (from __total__ rows)
    const adCostDaily: Array<{ name: string; value: number }> = [];
    const revDaily: Array<{ name: string; value: number }> = [];
    const dailyByDate: Record<string, { cost: number; rev: number; clicks: number; impressions: number }> = {};
    for (const row of totalRows) {
      if (!dailyByDate[row.date]) dailyByDate[row.date] = { cost: 0, rev: 0, clicks: 0, impressions: 0 };
      dailyByDate[row.date].cost += row.ad_cost || 0;
      dailyByDate[row.date].rev += row.ga_revenue || 0;
      dailyByDate[row.date].clicks += row.ad_clicks || 0;
      dailyByDate[row.date].impressions += row.ad_impressions || 0;
    }
    for (const [date, v] of Object.entries(dailyByDate).sort(([a],[b]) => a.localeCompare(b))) {
      adCostDaily.push({ name: date, value: Math.round(v.cost) });
      revDaily.push({ name: date, value: Math.round(v.rev) });
    }

    return NextResponse.json({
      kpis: {
        sessions: totals.sessions,
        users: totals.users,
        newUsers: totals.newUsers,
        pageviews: totals.pageviews,
        transactions: totals.transactions,
        revenue: Math.round(totals.revenue),
        conversionRate: Math.round(conversionRate * 100) / 100,
        adCost: Math.round(totals.adCost * 100) / 100,
        adClicks: totals.adClicks,
        adImpressions: totals.adImpressions,
      },
      charts: {
        sessionsTimeSeries,
        sourcePie,
        adCostDaily,
        revDaily,
      },
      sourceTable,
      hostnames: [...hostnames],
      dataInfo: {
        totalRowsInDb: totalRows.length,
        detailRowsInDb: detailRows.length,
        oldestDate: totalRows.length > 0 ? totalRows.reduce((min, r) => r.date < min ? r.date : min, totalRows[0].date) : null,
        newestDate: totalRows.length > 0 ? totalRows.reduce((max, r) => r.date > max ? r.date : max, totalRows[0].date) : null,
      },
    });
  } catch (err) {
    console.error('Traffic API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
