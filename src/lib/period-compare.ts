// Wspólne helpery do automatycznego porównania okresu z poprzednim
// (równolegle długim, cofniętym o jego długość). Używane na wszystkich
// stronach dashboardu — każda strona robi po prostu drugi fetch z
// `previousPeriod(filters.dateFrom, filters.dateTo)` i przelicza zmianę
// per KPI przez `pctChange`.

export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const fromD = new Date(from);
  const toD = new Date(to);
  if (!Number.isFinite(fromD.getTime()) || !Number.isFinite(toD.getTime())) {
    return { from, to };
  }
  const days = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1);
  const prevTo = new Date(fromD);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (days - 1));
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { from: fmt(prevFrom), to: fmt(prevTo) };
}

// Procentowa zmiana current vs previous. Null gdy brak danych.
export function pctChange(curr: number | null | undefined, prev: number | null | undefined): number | null {
  if (curr == null || prev == null) return null;
  const c = Number(curr); const p = Number(prev);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return null;
  if (p === 0) return null;   // unikamy dzielenia przez 0; brak referencji do porównania
  return ((c - p) / Math.abs(p)) * 100;
}

// Pomocniczy label „vs poprzedni okres" — używany pod wartością KPI.
export const COMPARE_LABEL = 'vs poprz. okres';
