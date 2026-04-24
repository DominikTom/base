// NBP API — kursy EUR/PLN tabela A (średni ważony).
// Endpoint zwraca 404 w weekendy i święta — cofamy do ostatniego dnia roboczego.
// Cache module-level, żyje przez lifetime funkcji (serverless: per-invocation).

const rateCache = new Map<string, number>();

const NBP_BASE = 'https://api.nbp.pl/api/exchangerates/rates/A/EUR';

function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getEurPlnRate(date: string): Promise<number> {
  const cached = rateCache.get(date);
  if (cached !== undefined) return cached;

  for (let back = 0; back < 7; back++) {
    const probe = shiftDate(date, -back);
    const res = await fetch(`${NBP_BASE}/${probe}/?format=json`);
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`NBP API ${res.status} for ${probe}`);
    const json = await res.json();
    const rate = json?.rates?.[0]?.mid;
    if (typeof rate !== 'number') throw new Error(`NBP: unexpected response for ${probe}`);
    rateCache.set(date, rate);
    return rate;
  }
  throw new Error(`NBP: no EUR rate for ${date} or 7 days prior`);
}

export async function getEurPlnRates(dates: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = Array.from(new Set(dates));
  await Promise.all(uniq.map(async d => { out.set(d, await getEurPlnRate(d)); }));
  return out;
}
