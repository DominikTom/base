import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { WEATHER_LOCATIONS, type WeatherLocation } from '@/lib/weather';

// ─────────────────────────────────────────────────────────────────────
// ETL pogody — dociąga brakujące daty z Open-Meteo do tabeli weather_daily.
//
//   Open-Meteo: free, bez klucza. Dwa endpointy:
//     - archive-api.open-meteo.com/v1/archive — historyczne (dane od 1940
//       ale z opóźnieniem ~5 dni względem dzisiaj).
//     - api.open-meteo.com/v1/forecast?past_days=N — ostatnie 92 dni
//       (z prognozą, brak opóźnienia).
//
//   Strategia: każda lokalizacja → dwa fetche (archive dla zakresu z
//   bezpiecznym buforem + forecast dla ostatnich 14 dni). Upsert do tabeli.
//
//   Wywołanie: GET /api/jobs/sync-weather?from=YYYY-MM-DD&to=YYYY-MM-DD
//     (domyślnie ostatnie 365 dni do dziś).
// ─────────────────────────────────────────────────────────────────────

const DAILY_METRICS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'temperature_2m_mean',
  'precipitation_sum',
  'sunshine_duration',
  'wind_speed_10m_max',
];

interface OpenMeteoDaily {
  daily?: {
    time?: string[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    temperature_2m_mean?: (number | null)[];
    precipitation_sum?: (number | null)[];
    sunshine_duration?: (number | null)[];
    wind_speed_10m_max?: (number | null)[];
  };
}

async function fetchArchive(loc: WeatherLocation, from: string, to: string): Promise<OpenMeteoDaily> {
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude', String(loc.lat));
  url.searchParams.set('longitude', String(loc.lon));
  url.searchParams.set('start_date', from);
  url.searchParams.set('end_date', to);
  url.searchParams.set('daily', DAILY_METRICS.join(','));
  url.searchParams.set('timezone', loc.timezone);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Archive fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchForecast(loc: WeatherLocation, pastDays: number): Promise<OpenMeteoDaily> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(loc.lat));
  url.searchParams.set('longitude', String(loc.lon));
  url.searchParams.set('past_days', String(Math.min(pastDays, 92)));
  url.searchParams.set('forecast_days', '0');
  url.searchParams.set('daily', DAILY_METRICS.join(','));
  url.searchParams.set('timezone', loc.timezone);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Forecast fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

interface UpsertRow {
  date: string;
  location_key: string;
  temp_max: number | null;
  temp_min: number | null;
  temp_mean: number | null;
  precip_mm: number | null;
  sunshine_h: number | null;
  wind_max: number | null;
  raw: OpenMeteoDaily;
}

function rowsFromResponse(j: OpenMeteoDaily, location_key: string): UpsertRow[] {
  const d = j.daily;
  if (!d || !Array.isArray(d.time)) return [];
  const out: UpsertRow[] = [];
  for (let i = 0; i < d.time.length; i++) {
    const sun = d.sunshine_duration?.[i];
    out.push({
      date: d.time[i],
      location_key,
      temp_max:  d.temperature_2m_max?.[i] ?? null,
      temp_min:  d.temperature_2m_min?.[i] ?? null,
      temp_mean: d.temperature_2m_mean?.[i] ?? null,
      precip_mm: d.precipitation_sum?.[i] ?? null,
      // sunshine_duration jest w sekundach — przeliczamy do godzin.
      sunshine_h: typeof sun === 'number' ? Math.round((sun / 3600) * 100) / 100 : null,
      wind_max:  d.wind_speed_10m_max?.[i] ?? null,
      raw: j,
    });
  }
  return out;
}

export async function GET(request: NextRequest) {
  try {
    const _guard = await requireAdmin();
    if (_guard) return _guard;
    const url = new URL(request.url);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const defaultFrom = new Date(today); defaultFrom.setDate(today.getDate() - 365);
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    const from = url.searchParams.get('from') || fmt(defaultFrom);
    const to = url.searchParams.get('to') || fmt(today);

    const db = getSupabaseAdmin();
    const totalsPerLocation: Record<string, number> = {};
    const errors: string[] = [];

    for (const loc of Object.values(WEATHER_LOCATIONS)) {
      try {
        const allRows: UpsertRow[] = [];

        // Archive [from..today-15], Forecast [today-14..today] — zero overlap.
        const archiveCutoff = new Date(today); archiveCutoff.setDate(today.getDate() - 15);
        const archiveCutoffStr = fmt(archiveCutoff);

        if (from <= archiveCutoffStr) {
          const archiveEndStr = archiveCutoffStr < to ? archiveCutoffStr : to;
          const j = await fetchArchive(loc, from, archiveEndStr);
          allRows.push(...rowsFromResponse(j, loc.key));
        }

        const j2 = await fetchForecast(loc, 14);
        allRows.push(...rowsFromResponse(j2, loc.key));

        // Trim do zakresu from..to + dedup po (date, location_key).
        const filtered = allRows.filter(r => r.date >= from && r.date <= to);
        const dedupMap = new Map<string, UpsertRow>();
        for (const r of filtered) dedupMap.set(`${r.date}|${r.location_key}`, r);
        const finalRows = [...dedupMap.values()];

        if (finalRows.length === 0) {
          totalsPerLocation[loc.key] = 0;
          continue;
        }

        // ─── DELETE + INSERT (bez upsert) ────────────────────────────
        // Supabase-js 2.103.2 z `ignoreDuplicates: true` mimo wszystko
        // generuje `ON CONFLICT DO UPDATE` (bug w libie), który wybucha
        // gdy w batch'u są dwa rzędy z tym samym PK. Obchodzimy to
        // czyszcząc cały zakres przed INSERT — wtedy żaden ON CONFLICT
        // nie jest potrzebny, a Postgres nawet nie ma jak rzucić błędu
        // „ON CONFLICT DO UPDATE cannot affect row a second time" (bo
        // brak klauzuli ON CONFLICT).
        //
        // Dedup powyżej gwarantuje brak duplikatów PK w INSERT.

        const dates = finalRows.map(r => r.date);
        const minDate = dates.reduce((a, b) => (a < b ? a : b));
        const maxDate = dates.reduce((a, b) => (a > b ? a : b));

        const { error: delErr } = await db.from('weather_daily')
          .delete()
          .eq('location_key', loc.key)
          .gte('date', minDate)
          .lte('date', maxDate);
        if (delErr) throw new Error(`DELETE ${loc.key}: ${delErr.message}`);

        let inserted = 0;
        for (let i = 0; i < finalRows.length; i += 200) {
          const chunk = finalRows.slice(i, i + 200);
          const { error: insErr } = await db.from('weather_daily').insert(chunk);
          if (insErr) {
            // Log szczegółowy — jak jeszcze coś dziwnego zadziała, mamy info
            console.error(`Insert ${loc.key} chunk ${i}/${finalRows.length}:`, insErr);
            throw new Error(`INSERT ${loc.key} (chunk @ ${i}): ${insErr.message}`);
          }
          inserted += chunk.length;
        }
        totalsPerLocation[loc.key] = inserted;
      } catch (locErr) {
        // Jeden lokacja padła ale druga może działać — zapisz błąd, idź dalej.
        console.error(`Location ${loc.key} sync failed:`, locErr);
        totalsPerLocation[loc.key] = -1;
        errors.push(`${loc.key}: ${String(locErr instanceof Error ? locErr.message : locErr)}`);
      }
    }

    return NextResponse.json({
      ok: errors.length === 0,
      from, to,
      synced: totalsPerLocation,
      errors: errors.length > 0 ? errors : undefined,
    }, { status: errors.length > 0 && Object.values(totalsPerLocation).every(v => v <= 0) ? 500 : 200 });
  } catch (err) {
    console.error('sync-weather error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
