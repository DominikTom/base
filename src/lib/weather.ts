// Mapowanie sklep → kluczowa lokalizacja pogodowa. Sklepy obsługujące rynek
// niemiecki dostają pogodę z Berlina, polskie z Warszawy. Nieobsługiwane (np.
// Allegro PL ma własną logistykę) wpadają do Warszawy domyślnie.

export interface WeatherLocation {
  key: string;
  label: string;
  lat: number;
  lon: number;
  timezone: string;
}

export const WEATHER_LOCATIONS: Record<string, WeatherLocation> = {
  warsaw: { key: 'warsaw', label: 'Warszawa',  lat: 52.2297, lon: 21.0122, timezone: 'Europe/Warsaw'  },
  berlin: { key: 'berlin', label: 'Berlin',    lat: 52.5200, lon: 13.4050, timezone: 'Europe/Berlin'  },
};

export function shopToLocationKey(shop: string): 'warsaw' | 'berlin' {
  if (!shop) return 'warsaw';
  const s = shop.toLowerCase();
  if (s.endsWith('.de') || s === 'amazon.de' || s === 'kaufland.de') return 'berlin';
  return 'warsaw';
}

// Lista metryk pogodowych z Open-Meteo, które trzymamy w cache.
// `key` = kolumna w tabeli weather_daily i klucz w `dailyMetrics`.
export const WEATHER_METRICS = [
  { key: 'temp_max',   label: 'Temperatura max',     unit: '°C' },
  { key: 'temp_min',   label: 'Temperatura min',     unit: '°C' },
  { key: 'temp_mean',  label: 'Temperatura średnia', unit: '°C' },
  { key: 'precip_mm',  label: 'Opady',               unit: 'mm' },
  { key: 'sunshine_h', label: 'Nasłonecznienie',     unit: 'h' },
  { key: 'wind_max',   label: 'Wiatr max',           unit: 'km/h' },
] as const;
export type WeatherMetricKey = typeof WEATHER_METRICS[number]['key'];

// ──────────────────────────────────────────────────────────────────
// Pearson correlation. NULL/NaN i niesparowane wartości są pomijane.
// Zwraca {r, n, valid}. r ∈ [-1,1]. valid=false gdy za mało danych lub
// jedna seria jest stała.
// ──────────────────────────────────────────────────────────────────
export function pearson(xs: number[], ys: number[]): { r: number; n: number; valid: boolean } {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = xs[i]; const y = ys[i];
    if (Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y]);
  }
  const n = pairs.length;
  if (n < 3) return { r: 0, n, valid: false };
  let sx = 0, sy = 0;
  for (const [x, y] of pairs) { sx += x; sy += y; }
  const mx = sx / n; const my = sy / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (const [x, y] of pairs) {
    const dx = x - mx; const dy = y - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return { r: 0, n, valid: false };
  return { r: num / denom, n, valid: true };
}
