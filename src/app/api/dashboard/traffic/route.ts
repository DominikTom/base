import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from') || '2025-01-01';
    const dateTo = searchParams.get('date_to') || new Date().toISOString().split('T')[0];
    const hostname = searchParams.get('hostname') || 'all';

    let query = supabaseAdmin
      .from('fact_daily_traffic')
      .select('*')
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date', { ascending: true });

    if (hostname !== 'all') {
      query = query.eq('hostname', hostname);
    }

    const { data: trafficData, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // KPIs
    const totals = (trafficData || []).reduce(
      (acc, row) => {
        acc.sessions += row.sessions || 0;
        acc.users += row.users || 0;
        acc.newUsers += row.new_users || 0;
        acc.pageviews += row.pageviews || 0;
        acc.transactions += row.transactions || 0;
        acc.revenue += row.ga_revenue || 0;
        return acc;
      },
      { sessions: 0, users: 0, newUsers: 0, pageviews: 0, transactions: 0, revenue: 0 }
    );

    const conversionRate = totals.sessions > 0 ? (totals.transactions / totals.sessions) * 100 : 0;

    // Sessions over time by hostname
    const sessionsMap: Record<string, Record<string, number>> = {};
    const hostnames = new Set<string>();
    for (const row of trafficData || []) {
      if (!sessionsMap[row.date]) sessionsMap[row.date] = {};
      sessionsMap[row.date][row.hostname] = (sessionsMap[row.date][row.hostname] || 0) + (row.sessions || 0);
      hostnames.add(row.hostname);
    }
    const sessionsTimeSeries = Object.entries(sessionsMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({ date, ...values }));

    // Source/Medium breakdown
    const sourceMap: Record<string, { sessions: number; transactions: number; revenue: number }> = {};
    for (const row of trafficData || []) {
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

    return NextResponse.json({
      kpis: {
        sessions: totals.sessions,
        users: totals.users,
        newUsers: totals.newUsers,
        pageviews: totals.pageviews,
        transactions: totals.transactions,
        revenue: Math.round(totals.revenue),
        conversionRate: Math.round(conversionRate * 100) / 100,
      },
      charts: {
        sessionsTimeSeries,
        sourcePie,
      },
      sourceTable,
      hostnames: [...hostnames],
    });
  } catch (err) {
    console.error('Traffic API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
