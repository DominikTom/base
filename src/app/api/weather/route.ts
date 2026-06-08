import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { shopToLocationKey, WEATHER_LOCATIONS, WEATHER_METRICS, type WeatherMetricKey, pearson } from '@/lib/weather';

// ─────────────────────────────────────────────────────────────────────
// /api/weather — łączy dzienną sprzedaż (fact_orders) z dzienną pogodą
//   (weather_daily) dla wybranego sklepu, liczy Pearson dla wybranej metryki
//   pogodowej vs (revenue | orders).
//
//   GET ?shop=mybed.pl|all&from=YYYY-MM-DD&to=YYYY-MM-DD
//                                                  &metric=temp_mean (default)
//                                                  &y=revenue|orders (default revenue)
// ─────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const shop = (url.searchParams.get('shop') || 'all').toLowerCase();
    const from = url.searchParams.get('from') || new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
    const to = url.searchParams.get('to') || new Date().toISOString().split('T')[0];
    const metric = (url.searchParams.get('metric') || 'temp_mean') as WeatherMetricKey;
    const y = url.searchParams.get('y') === 'orders' ? 'orders' : 'revenue';

    if (!WEATHER_METRICS.some(m => m.key === metric)) {
      return NextResponse.json({ error: `Niedozwolona metryka: ${metric}` }, { status: 400 });
    }

    const db = getSupabaseAdmin();

    // Lokalizacja: jeśli shop = 'all' → bierzemy obie i agregujemy sprzedaż,
    // korelujemy do średniej z dwóch lokalizacji. Inaczej jedna lokalizacja.
    const locationKeys = shop === 'all'
      ? Object.keys(WEATHER_LOCATIONS)
      : [shopToLocationKey(shop)];

    // ── Pogoda ─────────────────────────────────────────────────────
    const { data: weatherData, error: wErr } = await db
      .from('weather_daily')
      .select(`date, location_key, ${metric}`)
      .in('location_key', locationKeys)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true });
    if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 });

    // Średnia metryki per dzień (gdy wiele lokalizacji)
    const weatherByDate: Record<string, number[]> = {};
    for (const row of weatherData || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = (row as any)[metric];
      if (typeof v !== 'number') continue;
      const date = String((row as { date: string }).date);
      (weatherByDate[date] ||= []).push(v);
    }
    const weatherSeries: Array<{ date: string; weather: number }> = Object.entries(weatherByDate)
      .map(([date, vals]) => ({ date, weather: vals.reduce((s, v) => s + v, 0) / vals.length }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ── Sprzedaż dziennie (paginowana — PostgREST 1000 cap) ─────────
    const PAGE = 1000;
    const orders: Array<{ order_date: string; total_gross_pln: number | null; source_shop: string | null }> = [];
    let offset = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let q = db.from('fact_orders')
        .select('order_date, total_gross_pln, source_shop')
        .gte('order_date', from)
        .lte('order_date', `${to}T23:59:59`)
        .range(offset, offset + PAGE - 1);
      if (shop !== 'all') q = q.eq('source_shop', shop);
      const { data, error } = await q;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data || data.length === 0) break;
      orders.push(...(data as typeof orders));
      if (data.length < PAGE) break;
      offset += PAGE;
    }

    const salesByDate: Record<string, { revenue: number; orders: number }> = {};
    for (const o of orders) {
      const d = String(o.order_date).slice(0, 10);
      const r = (salesByDate[d] ||= { revenue: 0, orders: 0 });
      r.revenue += Number(o.total_gross_pln) || 0;
      r.orders += 1;
    }

    // ── Połącz dzień po dniu (uwzględnij dni 0-sprzedaży aby nie biasować korelacji) ─
    const allDates = new Set<string>([
      ...Object.keys(weatherByDate),
      ...Object.keys(salesByDate),
    ]);
    const series = Array.from(allDates).sort().map(date => {
      const wArr = weatherByDate[date];
      const w = wArr && wArr.length > 0 ? wArr.reduce((s, v) => s + v, 0) / wArr.length : null;
      const s = salesByDate[date] || { revenue: 0, orders: 0 };
      return {
        date,
        weather: w,
        revenue: Math.round(s.revenue),
        orders: s.orders,
      };
    });

    // ── Korelacja ─────────────────────────────────────────────────
    const xs: number[] = [];
    const ys: number[] = [];
    for (const row of series) {
      if (row.weather == null) continue;
      xs.push(row.weather);
      ys.push(y === 'orders' ? row.orders : row.revenue);
    }
    const corr = pearson(xs, ys);

    // ── KPI agregaty pogody ──────────────────────────────────────
    const wValues = series.filter(r => r.weather != null).map(r => r.weather as number);
    const wMean = wValues.length ? wValues.reduce((s, v) => s + v, 0) / wValues.length : null;
    const wMin = wValues.length ? Math.min(...wValues) : null;
    const wMax = wValues.length ? Math.max(...wValues) : null;
    const totalRevenue = series.reduce((s, r) => s + r.revenue, 0);
    const totalOrders = series.reduce((s, r) => s + r.orders, 0);

    return NextResponse.json({
      shop, from, to, metric, y,
      series,
      stats: {
        weatherMean: wMean,
        weatherMin: wMin,
        weatherMax: wMax,
        totalRevenue: Math.round(totalRevenue),
        totalOrders,
        correlation: corr,
      },
      locationKeys,
      weatherSeries, // legacy compat
    });
  } catch (err) {
    console.error('weather GET error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
