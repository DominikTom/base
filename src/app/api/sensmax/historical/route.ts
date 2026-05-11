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
    const { data, error } = await db
      .from('sensmax_daily_by_showroom')
      .select('showroom,date,visits_total')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []).map((r) => ({
      showroom: r.showroom as Showroom,
      date: r.date as string,
      visits: Number(r.visits_total) || 0,
    }));
    const totals: Record<string, number> = {};
    for (const r of rows) totals[r.showroom] = (totals[r.showroom] ?? 0) + r.visits;

    return NextResponse.json({ mode: 'all', from, to, rows, totals });
  }

  const hourlyFrom = clampHourlyFrom(from, to);
  const [dailyRes, hourlyRes] = await Promise.all([
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
  ]);

  if (dailyRes.error) return NextResponse.json({ error: dailyRes.error.message }, { status: 500 });
  if (hourlyRes.error) return NextResponse.json({ error: hourlyRes.error.message }, { status: 500 });

  return NextResponse.json({
    mode: 'single',
    showroom,
    from,
    to,
    hourlyFrom,
    daily: (dailyRes.data ?? []).map((r) => ({ date: r.date as string, visits: Number(r.visits_total) || 0, errors: Number(r.errors_total) || 0 })),
    hourly: (hourlyRes.data ?? []).map((r) => ({ date: r.date as string, hour: Number(r.hour) || 0, visits: Number(r.visits) || 0 })),
  });
}
