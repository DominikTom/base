import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { SHOWROOMS, type Showroom } from '@/lib/sensmax/types';

export const dynamic = 'force-dynamic';

// Hourly rows are one per (showroom, date, hour); cap the hourly window so a
// wide global date range can't blow past Supabase's 1000-row response cap.
const MAX_HOURLY_DAYS = 35;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function clampHourlyFrom(from: string, to: string): string {
  const cap = new Date(`${to}T00:00:00Z`);
  cap.setUTCDate(cap.getUTCDate() - (MAX_HOURLY_DAYS - 1));
  const capIso = isoDate(cap);
  return from > capIso ? from : capIso;
}

interface SalesRow {
  showroom: Showroom;
  date: string;
  orders: number;
  revenue: number;
  bookedOrders: number;
  bookedRevenue: number;
}

function mapSales(data: Array<Record<string, unknown>> | null): SalesRow[] {
  return (data ?? []).map((r) => ({
    showroom: r.showroom as Showroom,
    date: r.date as string,
    orders: Number(r.orders) || 0,
    revenue: Number(r.revenue_pln) || 0,
    bookedOrders: Number(r.booked_orders) || 0,
    bookedRevenue: Number(r.booked_revenue_pln) || 0,
  }));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const showroom = searchParams.get('showroom');
  const isAll = showroom === 'all';
  if (!isAll && (!showroom || !SHOWROOMS.includes(showroom as Showroom))) {
    return NextResponse.json({ error: 'Missing or invalid showroom' }, { status: 400 });
  }

  const to = searchParams.get('to') ?? isoDate(new Date());
  const fromDefault = new Date(`${to}T00:00:00Z`);
  fromDefault.setUTCDate(fromDefault.getUTCDate() - 30);
  const from = searchParams.get('from') ?? isoDate(fromDefault);

  const db = getSupabaseAdmin();

  if (isAll) {
    const [visitsRes, salesRes] = await Promise.all([
      db
        .from('sensmax_daily_by_showroom')
        .select('showroom,date,visits_total')
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true }),
      db
        .from('sensmax_showroom_sales')
        .select('showroom,date,orders,revenue_pln,booked_orders,booked_revenue_pln')
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true }),
    ]);
    if (visitsRes.error) return NextResponse.json({ error: visitsRes.error.message }, { status: 500 });
    if (salesRes.error) return NextResponse.json({ error: salesRes.error.message }, { status: 500 });

    const rows = (visitsRes.data ?? []).map((r) => ({
      showroom: r.showroom as Showroom,
      date: r.date as string,
      visits: Number(r.visits_total) || 0,
    }));
    const totals: Record<string, number> = {};
    for (const r of rows) totals[r.showroom] = (totals[r.showroom] ?? 0) + r.visits;

    const sales = mapSales(salesRes.data);
    const salesTotals: Record<string, { orders: number; revenue: number; bookedOrders: number; bookedRevenue: number }> = {};
    for (const r of sales) {
      const t = (salesTotals[r.showroom] ??= { orders: 0, revenue: 0, bookedOrders: 0, bookedRevenue: 0 });
      t.orders += r.orders;
      t.revenue += r.revenue;
      t.bookedOrders += r.bookedOrders;
      t.bookedRevenue += r.bookedRevenue;
    }

    return NextResponse.json({ mode: 'all', from, to, rows, totals, sales, salesTotals });
  }

  const hourlyFrom = clampHourlyFrom(from, to);
  const [dailyRes, hourlyRes, salesRes] = await Promise.all([
    db
      .from('sensmax_daily_by_showroom')
      .select('date,visits_total,errors_total')
      .eq('showroom', showroom)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true }),
    db
      .from('sensmax_hourly_by_showroom')
      .select('date,hour,visits')
      .eq('showroom', showroom)
      .gte('date', hourlyFrom)
      .lte('date', to)
      .order('date', { ascending: true })
      .order('hour', { ascending: true }),
    db
      .from('sensmax_showroom_sales')
      .select('showroom,date,orders,revenue_pln,booked_orders,booked_revenue_pln')
      .eq('showroom', showroom)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true }),
  ]);

  if (dailyRes.error) return NextResponse.json({ error: dailyRes.error.message }, { status: 500 });
  if (hourlyRes.error) return NextResponse.json({ error: hourlyRes.error.message }, { status: 500 });
  if (salesRes.error) return NextResponse.json({ error: salesRes.error.message }, { status: 500 });

  return NextResponse.json({
    mode: 'single',
    showroom,
    from,
    to,
    hourlyFrom,
    daily: (dailyRes.data ?? []).map((r) => ({ date: r.date as string, visits: Number(r.visits_total) || 0, errors: Number(r.errors_total) || 0 })),
    hourly: (hourlyRes.data ?? []).map((r) => ({ date: r.date as string, hour: Number(r.hour) || 0, visits: Number(r.visits) || 0 })),
    sales: mapSales(salesRes.data).map(({ date, orders, revenue, bookedOrders, bookedRevenue }) => ({ date, orders, revenue, bookedOrders, bookedRevenue })),
  });
}
