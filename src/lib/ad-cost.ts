import type { SupabaseClient } from '@supabase/supabase-js';

// GA4 raportuje wartości pieniężne (ad_cost, ga_revenue) w walucie property.
// Per sklep / hostname:
const HOSTNAME_CURRENCY: Record<string, string> = {
  'mybed.pl': 'PLN',
  'mittohome.pl': 'PLN',
  'mybed.de': 'EUR',
};

// Fallback gdy w danym okresie nie mamy żadnego kursu z zamówień.
const FALLBACK_RATE_TO_PLN: Record<string, number> = { EUR: 4.30 };

export interface EurRateMap {
  byDate: Record<string, number>;
  fallback: number;
}

// Pobiera dzienne kursy EUR→PLN z fact_orders.exchange_rate (gdzie ETL ERP
// zapisuje kurs per zamówienie EUR). To jedyne źródło kursów w tej bazie —
// dim_exchange_rates jest puste.
export async function fetchEurRatesByDate(
  db: SupabaseClient,
  dateFrom: string,
  dateTo: string,
): Promise<EurRateMap> {
  const { data } = await db
    .from('fact_orders')
    .select('order_date, exchange_rate')
    .eq('currency', 'EUR')
    .gte('order_date', dateFrom)
    .lte('order_date', dateTo + 'T23:59:59')
    .limit(50000);
  const sums: Record<string, { sum: number; n: number }> = {};
  for (const r of (data || []) as Array<{ order_date: string; exchange_rate: number }>) {
    const d = String(r.order_date).substring(0, 10);
    const rate = Number(r.exchange_rate) || 0;
    if (rate <= 0) continue;
    if (!sums[d]) sums[d] = { sum: 0, n: 0 };
    sums[d].sum += rate;
    sums[d].n += 1;
  }
  const byDate: Record<string, number> = {};
  let allSum = 0, allN = 0;
  for (const [d, v] of Object.entries(sums)) {
    byDate[d] = v.sum / v.n;
    allSum += v.sum;
    allN += v.n;
  }
  const fallback = allN > 0 ? allSum / allN : FALLBACK_RATE_TO_PLN.EUR;
  return { byDate, fallback };
}

function rateForDate(rates: EurRateMap, date: string): number {
  const d = date.substring(0, 10);
  if (rates.byDate[d]) return rates.byDate[d];
  // Najbliższy dzień wstecz; gdy brak — w przód; gdy w ogóle brak — fallback.
  const days = Object.keys(rates.byDate).sort();
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i] <= d) return rates.byDate[days[i]];
  }
  if (days.length) return rates.byDate[days[0]];
  return rates.fallback;
}

// Konwertuje wartość pieniężną z GA4 (np. ad_cost, ga_revenue) z waluty konta
// określanej po hostname na PLN. Hosty PLN przechodzą bez zmian.
export function gaToPln(
  hostname: string | null | undefined,
  value: number,
  date: string,
  rates: EurRateMap,
): number {
  const cur = HOSTNAME_CURRENCY[String(hostname || '').toLowerCase()] || 'PLN';
  if (cur === 'PLN') return value;
  if (cur === 'EUR') return value * rateForDate(rates, date);
  return value;
}
