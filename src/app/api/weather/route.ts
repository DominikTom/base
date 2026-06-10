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
    // Ciągniemy WSZYSTKIE metryki (nie tylko wybraną) — bucket analysis
    // potrzebuje temp/precip/sunshine niezależnie od tego co user ogląda.
    const { data: weatherData, error: wErr } = await db
      .from('weather_daily')
      .select('date, location_key, temp_max, temp_min, temp_mean, precip_mm, sunshine_h, wind_max')
      .in('location_key', locationKeys)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true });
    if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 });

    // Średnia każdej metryki per dzień (gdy wiele lokalizacji)
    type WeatherDay = { temp_max: number | null; temp_min: number | null; temp_mean: number | null; precip_mm: number | null; sunshine_h: number | null; wind_max: number | null };
    const weatherAccum: Record<string, Record<string, number[]>> = {};
    for (const row of weatherData || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = row as any;
      const date = String(r.date);
      if (!weatherAccum[date]) weatherAccum[date] = {};
      for (const k of ['temp_max', 'temp_min', 'temp_mean', 'precip_mm', 'sunshine_h', 'wind_max']) {
        const v = r[k];
        if (typeof v === 'number') (weatherAccum[date][k] ||= []).push(v);
      }
    }
    const weatherFull: Record<string, WeatherDay> = {};
    const weatherByDate: Record<string, number[]> = {};
    for (const [date, metrics] of Object.entries(weatherAccum)) {
      const avg = (k: string) => {
        const arr = metrics[k];
        return arr && arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
      };
      weatherFull[date] = {
        temp_max: avg('temp_max'), temp_min: avg('temp_min'), temp_mean: avg('temp_mean'),
        precip_mm: avg('precip_mm'), sunshine_h: avg('sunshine_h'), wind_max: avg('wind_max'),
      };
      const selected = avg(metric);
      if (selected != null) weatherByDate[date] = [selected];
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
      const wf = weatherFull[date];
      const round1 = (v: number | null | undefined) => (typeof v === 'number' ? Math.round(v * 10) / 10 : null);
      return {
        date,
        weather: w,
        // Wszystkie metryki pogody — frontend może nakładać kilka linii naraz.
        temp_max: round1(wf?.temp_max),
        temp_mean: round1(wf?.temp_mean),
        precip_mm: round1(wf?.precip_mm),
        sunshine_h: round1(wf?.sunshine_h),
        wind_max: round1(wf?.wind_max),
        revenue: Math.round(s.revenue),
        orders: s.orders,
      };
    });

    // ── Korelacja surowa ──────────────────────────────────────────
    const xs: number[] = [];
    const ys: number[] = [];
    for (const row of series) {
      if (row.weather == null) continue;
      xs.push(row.weather);
      ys.push(y === 'orders' ? row.orders : row.revenue);
    }
    const corr = pearson(xs, ys);

    // ── Normalizacja po dniu tygodnia ─────────────────────────────
    // Sprzedaż ma silną sezonowość tygodniową (pon ≠ sob), która zagłusza
    // pogodę w surowym Pearsonie. Liczymy „indeks": revenue dnia podzielone
    // przez średnią dla TEGO dnia tygodnia. Indeks 1.10 = dzień o 10% lepszy
    // niż typowy taki dzień tygodnia. Korelacja pogody z indeksem pokazuje
    // czysty efekt pogody.
    const weekdaySum: Record<number, { sum: number; n: number }> = {};
    for (const row of series) {
      const dow = new Date(row.date).getDay();
      const val = y === 'orders' ? row.orders : row.revenue;
      (weekdaySum[dow] ||= { sum: 0, n: 0 });
      weekdaySum[dow].sum += val;
      weekdaySum[dow].n += 1;
    }
    const weekdayAvg: Record<number, number> = {};
    for (const [dow, { sum, n }] of Object.entries(weekdaySum)) {
      weekdayAvg[Number(dow)] = n > 0 ? sum / n : 0;
    }
    const indexByDate: Record<string, number> = {};
    for (const row of series) {
      const dow = new Date(row.date).getDay();
      const avg = weekdayAvg[dow];
      if (!avg || avg <= 0) continue;
      const val = y === 'orders' ? row.orders : row.revenue;
      indexByDate[row.date] = val / avg;
    }

    // Korelacja pogody z indeksem (odszumiona z sezonowości tygodniowej)
    const nxs: number[] = [];
    const nys: number[] = [];
    for (const row of series) {
      if (row.weather == null) continue;
      const idx = indexByDate[row.date];
      if (idx == null) continue;
      nxs.push(row.weather);
      nys.push(idx);
    }
    const corrNormalized = pearson(nxs, nys);

    // ── Analiza kubełkowa ─────────────────────────────────────────
    // Grupujemy dni po kategoriach pogodowych i liczymy średni indeks
    // (weekday-normalized) per grupa. To łapie nieliniowe efekty których
    // Pearson nie widzi (np. „deszcz = więcej zakupów online" niezależnie
    // czy pada 2mm czy 12mm).
    interface Bucket { label: string; n: number; avgIndex: number | null; avgRevenue: number; pctVsAvg: number | null }
    function buildBuckets(groups: Array<{ label: string; match: (w: WeatherDay) => boolean }>): Bucket[] {
      return groups.map(g => {
        const days = series.filter(row => {
          const w = weatherFull[row.date];
          return w && g.match(w) && indexByDate[row.date] != null;
        });
        const n = days.length;
        if (n === 0) return { label: g.label, n: 0, avgIndex: null, avgRevenue: 0, pctVsAvg: null };
        const avgIndex = days.reduce((s, r) => s + indexByDate[r.date], 0) / n;
        const avgRevenue = days.reduce((s, r) => s + r.revenue, 0) / n;
        return {
          label: g.label,
          n,
          avgIndex: Math.round(avgIndex * 1000) / 1000,
          avgRevenue: Math.round(avgRevenue),
          pctVsAvg: Math.round((avgIndex - 1) * 1000) / 10, // % vs typowy dzień tygodnia
        };
      });
    }

    const buckets = {
      precip: buildBuckets([
        { label: 'Sucho (≤1 mm)', match: w => (w.precip_mm ?? 0) <= 1 },
        { label: 'Lekki deszcz (1–5 mm)', match: w => (w.precip_mm ?? 0) > 1 && (w.precip_mm ?? 0) <= 5 },
        { label: 'Mocny deszcz (>5 mm)', match: w => (w.precip_mm ?? 0) > 5 },
      ]),
      sunshine: buildBuckets([
        { label: 'Pochmurno (<3 h)', match: w => w.sunshine_h != null && w.sunshine_h < 3 },
        { label: 'Przejściowo (3–7 h)', match: w => w.sunshine_h != null && w.sunshine_h >= 3 && w.sunshine_h < 7 },
        { label: 'Słonecznie (≥7 h)', match: w => w.sunshine_h != null && w.sunshine_h >= 7 },
      ]),
      temp: buildBuckets([
        { label: 'Zimno (<8°C)', match: w => w.temp_mean != null && w.temp_mean < 8 },
        { label: 'Umiarkowanie (8–18°C)', match: w => w.temp_mean != null && w.temp_mean >= 8 && w.temp_mean < 18 },
        { label: 'Ciepło (≥18°C)', match: w => w.temp_mean != null && w.temp_mean >= 18 },
      ]),
    };

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
        correlationNormalized: corrNormalized,
      },
      buckets,
      locationKeys,
      weatherSeries, // legacy compat
    });
  } catch (err) {
    console.error('weather GET error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
