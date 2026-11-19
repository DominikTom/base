// Wspólny helper do aplikowania `filters_advanced` na zapytanie Supabase.
// Używany przez explorer i pivot.

export type ExplorerFilterOperator =
  | 'eq' | 'neq' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with'
  | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'is_null' | 'not_null';

export interface ExplorerFilter {
  field: string;
  operator: ExplorerFilterOperator;
  value?: string | number | boolean | Array<string | number>;
  value_to?: string | number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applySbFilters(query: any, filters: ExplorerFilter[], allowedFields: string[]) {
  for (const f of filters) {
    if (!allowedFields.includes(f.field)) continue;
    switch (f.operator) {
      case 'eq': query = query.eq(f.field, f.value); break;
      case 'neq': query = query.neq(f.field, f.value); break;
      case 'contains': query = query.ilike(f.field, `%${String(f.value || '')}%`); break;
      case 'not_contains': query = query.not(f.field, 'ilike', `%${String(f.value || '')}%`); break;
      case 'starts_with': query = query.ilike(f.field, `${String(f.value || '')}%`); break;
      case 'ends_with': query = query.ilike(f.field, `%${String(f.value || '')}`); break;
      case 'in': {
        const arr = Array.isArray(f.value) ? f.value : String(f.value || '').split(',').map(v => v.trim()).filter(Boolean);
        if (arr.length) query = query.in(f.field, arr);
        break;
      }
      case 'gt': query = query.gt(f.field, f.value); break;
      case 'gte': query = query.gte(f.field, f.value); break;
      case 'lt': query = query.lt(f.field, f.value); break;
      case 'lte': query = query.lte(f.field, f.value); break;
      case 'between':
        if (f.value != null && f.value_to != null) query = query.gte(f.field, f.value).lte(f.field, f.value_to);
        break;
      case 'is_null': query = query.is(f.field, null); break;
      case 'not_null': query = query.not(f.field, 'is', null); break;
    }
  }
  return query;
}
