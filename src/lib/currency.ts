const NBP_BASE = 'https://api.nbp.pl/api/exchangerates/rates/a/eur';

export const EUR_SHOPS = ['mybed.de', 'amazon.de', 'kaufland.de'];

export function isEurShop(shop: string): boolean {
  return EUR_SHOPS.includes(shop);
}

// Fallback rate if NBP is unreachable
export const EUR_TO_PLN_FALLBACK = 4.30;

// Cache for rates within the same request
const rateCache = new Map<string, number>();

export async function getEurPlnRate(date?: string): Promise<number> {
  const key = date || 'current';
  if (rateCache.has(key)) return rateCache.get(key)!;

  try {
    const url = date ? `${NBP_BASE}/${date}/?format=json` : `${NBP_BASE}/?format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const json = await res.json();
      const rate = json.rates?.[0]?.mid;
      if (typeof rate === 'number') {
        rateCache.set(key, rate);
        return rate;
      }
    }
  } catch { /* fallback */ }

  // If exact date fails (weekend/holiday), try last 5 days
  if (date) {
    try {
      const d = new Date(date);
      for (let i = 1; i <= 5; i++) {
        const prev = new Date(d);
        prev.setDate(prev.getDate() - i);
        const prevStr = prev.toISOString().substring(0, 10);
        const prevKey = prevStr;
        if (rateCache.has(prevKey)) { rateCache.set(key, rateCache.get(prevKey)!); return rateCache.get(prevKey)!; }
        try {
          const res = await fetch(`${NBP_BASE}/${prevStr}/?format=json`, { signal: AbortSignal.timeout(3000) });
          if (res.ok) {
            const json = await res.json();
            const rate = json.rates?.[0]?.mid;
            if (typeof rate === 'number') {
              rateCache.set(key, rate);
              rateCache.set(prevKey, rate);
              return rate;
            }
          }
        } catch { continue; }
      }
    } catch { /* fallback */ }
  }

  rateCache.set(key, EUR_TO_PLN_FALLBACK);
  return EUR_TO_PLN_FALLBACK;
}

// Get monthly average rates for a range of months
export async function getMonthlyRates(startMonth: string, endMonth: string): Promise<Map<string, number>> {
  const rates = new Map<string, number>();
  const start = new Date(startMonth + '-01');
  const end = new Date(endMonth + '-01');

  const current = new Date(start);
  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const monthKey = `${year}-${month}`;
    const firstDay = `${monthKey}-01`;
    const lastDay = new Date(year, current.getMonth() + 1, 0).toISOString().substring(0, 10);

    try {
      const res = await fetch(`${NBP_BASE}/${firstDay}/${lastDay}/?format=json`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const json = await res.json();
        const dayRates: number[] = (json.rates || []).map((r: { mid: number }) => r.mid).filter((r: number) => r > 0);
        if (dayRates.length > 0) {
          const avg = dayRates.reduce((s: number, r: number) => s + r, 0) / dayRates.length;
          rates.set(monthKey, Math.round(avg * 10000) / 10000);
        }
      }
    } catch { /* use fallback */ }

    if (!rates.has(monthKey)) rates.set(monthKey, EUR_TO_PLN_FALLBACK);
    current.setMonth(current.getMonth() + 1);
  }

  return rates;
}

export function getExchangeRate(currency: string): number {
  return currency === 'EUR' ? EUR_TO_PLN_FALLBACK : 1;
}

export function convertToPln(amount: number, currency: string): number {
  return amount * getExchangeRate(currency);
}
