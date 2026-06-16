// Helper do interpretacji filtra sklepu (filters.shop) jako CSV-string.
// Multi-select: filters.shop może być:
//   'all'                   → bez filtru (wszystkie sklepy)
//   'mybed.pl'              → pojedynczy sklep (legacy zgodność)
//   'mybed.pl,mybed.de'     → wiele sklepów (CSV)
//   '' lub null             → brak filtru (traktujemy jak 'all')

export function shopFilterToList(shop: string | null | undefined): string[] {
  if (!shop || shop === 'all') return [];
  return shop.split(',').map(s => s.trim()).filter(Boolean);
}

// PostgREST query helper — aplikuje filtr na kolumnie source_shop (lub innej)
// według wartości filters.shop. Pusta lista = brak filtru.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyShopFilter<T extends { eq: (...a: any[]) => any; in: (...a: any[]) => any }>(
  query: T,
  shop: string | null | undefined,
  column: string = 'source_shop',
): T {
  const list = shopFilterToList(shop);
  if (list.length === 0) return query;
  if (list.length === 1) return query.eq(column, list[0]);
  return query.in(column, list);
}

// Czytelna etykieta dla UI / AI summaries / log debug:
//   'all'   → 'wszystkie sklepy'
//   1 sklep → 'mybed.pl'
//   2 sklepy → 'mybed.pl, mybed.de'
export function shopFilterLabel(shop: string | null | undefined): string {
  const list = shopFilterToList(shop);
  if (list.length === 0) return 'wszystkie sklepy';
  return list.join(', ');
}
