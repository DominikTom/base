import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const showroom = searchParams.get('showroom');
  const to = searchParams.get('to') ?? new Date().toISOString().slice(0, 10);
  const fromDate = new Date(to);
  fromDate.setDate(fromDate.getDate() - 30);
  const from = searchParams.get('from') ?? fromDate.toISOString().slice(0, 10);

  if (!showroom) return NextResponse.json({ error: 'Missing showroom' }, { status: 400 });

  const { data, error } = await getSupabaseAdmin()
    .from('sensmax_hourly_visits')
    .select('date,hour,visits,errors,sensmax_sensors!inner(showroom)')
    .eq('sensmax_sensors.showroom', showroom)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })
    .order('hour', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ showroom, from, to, rows: data?.map((r) => ({ date: r.date, hour: r.hour, visits: r.visits, errors: r.errors })) ?? [] });
}
