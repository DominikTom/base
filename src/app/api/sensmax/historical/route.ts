import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { SHOWROOMS, type Showroom } from '@/lib/sensmax/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const showroom = searchParams.get('showroom');
  if (!showroom || !SHOWROOMS.includes(showroom as Showroom)) {
    return NextResponse.json({ error: 'Missing or invalid showroom' }, { status: 400 });
  }

  const to = searchParams.get('to') ?? new Date().toISOString().slice(0, 10);
  const fromDefault = new Date(`${to}T00:00:00Z`);
  fromDefault.setUTCDate(fromDefault.getUTCDate() - 30);
  const from = searchParams.get('from') ?? fromDefault.toISOString().slice(0, 10);

  const db = getSupabaseAdmin();
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
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true })
      .order('hour', { ascending: true }),
  ]);

  if (dailyRes.error) return NextResponse.json({ error: dailyRes.error.message }, { status: 500 });
  if (hourlyRes.error) return NextResponse.json({ error: hourlyRes.error.message }, { status: 500 });

  return NextResponse.json({
    showroom,
    from,
    to,
    daily: (dailyRes.data ?? []).map((r) => ({ date: r.date as string, visits: Number(r.visits_total) || 0, errors: Number(r.errors_total) || 0 })),
    hourly: (hourlyRes.data ?? []).map((r) => ({ date: r.date as string, hour: Number(r.hour) || 0, visits: Number(r.visits) || 0 })),
  });
}
