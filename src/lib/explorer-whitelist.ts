// Wspólna whitelista pól dla eksploratora danych, rejestru KPI i narzędzi
// asystenta AI. Jedno źródło prawdy — używane przez:
//   - /api/dashboard/explorer (zapytania widgetów)
//   - /api/kpi (walidacja query_spec)
//   - narzędzia asystenta AI (create_widget / create_kpi)

export const ALLOWED_X_AXES: string[] = [
  // Z fact_orders
  'date', 'source_shop', 'source_platform', 'supplier', 'delivery_city', 'status', 'coupon_code',
  // Z fact_order_items (ziarno pozycji)
  'product_category', 'fabric_collection', 'bed_size', 'mattress_type', 'headboard_height',
];

// y_axis decyduje też o zbiorze danych:
//   orders_*  → fact_orders (+ items)
//   meta_*    → fact_daily_adspend WHERE platform='meta'
//   sessions/transactions/users/pageviews/ga_revenue/google_spend → fact_daily_traffic (source='__total__')
export const ALLOWED_Y_AXES: string[] = [
  // Z zamówień
  'revenue_gross', 'orders_count', 'avg_order_value', 'quantity',
  'revenue_paid', 'orders_paid', 'orders_cancelled', 'shipping_revenue',
  // Z Meta Ads
  'meta_spend', 'meta_revenue', 'meta_impressions', 'meta_clicks', 'meta_conversions',
  'meta_ctr', 'meta_cpc', 'meta_roas',
  // Z ruchu / Google Ads
  'google_spend', 'sessions', 'users', 'transactions', 'ga_revenue', 'pageviews',
];

export const ALLOWED_GROUP_BY: string[] = [
  'source_shop', 'source_platform', 'supplier',
  'product_category', 'fabric_collection', 'bed_size', 'mattress_type', 'headboard_height',
  'status', 'delivery_city',
];

export const FILTERABLE_FIELDS: string[] = [
  'source_shop', 'source_platform', 'supplier', 'status', 'delivery_city', 'coupon_code',
  'product_name', 'product_category', 'fabric_collection', 'fabric', 'bed_size',
  'mattress_type', 'headboard_height', 'storage_type',
  'total_gross_pln', 'quantity', 'is_sample',
];

export const ALLOWED_CHART_TYPES: string[] = ['bar', 'line', 'area', 'pie', 'table'];

export const ALLOWED_GRANULARITIES: string[] = ['day', 'week', 'month', 'quarter'];

export const ALLOWED_FILTER_OPERATORS: string[] = [
  'eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with',
  'in', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'not_null',
];

// Mapowanie account_id Meta Ads → sklep. Używane przez eksplorator i widgety
// (fact_daily_adspend nie ma kolumny source_shop — pojedyncze konto = sklep).
export const META_ACCOUNT_TO_SHOP: Record<string, string> = {
  'act_1681802382204753': 'mybed.pl',
  'act_637792865917248': 'mybed.de',
  'act_797212915921530': 'mittohome.pl',
};

// Datasety y_axis → dyspozytor w eksploratorze.
const META_MEASURES = new Set(['meta_spend', 'meta_revenue', 'meta_impressions', 'meta_clicks', 'meta_conversions', 'meta_ctr', 'meta_cpc', 'meta_roas']);
const TRAFFIC_MEASURES = new Set(['google_spend', 'sessions', 'users', 'transactions', 'ga_revenue', 'pageviews']);
export function measureDataset(y: string): 'meta' | 'traffic' | 'orders' {
  if (META_MEASURES.has(y)) return 'meta';
  if (TRAFFIC_MEASURES.has(y)) return 'traffic';
  return 'orders';
}

export type AdvancedFilter = {
  field: string;
  operator: string;
  value?: string;
  value_to?: string;
};

export interface QuerySpec {
  chart_type: string;
  x_axis: string;
  y_axis: string;
  group_by?: string;
  granularity: string;
  filters_advanced?: AdvancedFilter[];
}

// Waliduje query_spec względem whitelist. Zwraca listę błędów (pusta = OK).
export function validateQuerySpec(spec: Partial<QuerySpec> | null | undefined): string[] {
  const errors: string[] = [];
  if (!spec || typeof spec !== 'object') return ['query_spec jest wymagane'];

  if (!ALLOWED_X_AXES.includes(String(spec.x_axis))) {
    errors.push(`Niedozwolone x_axis: ${spec.x_axis}`);
  }
  if (!ALLOWED_Y_AXES.includes(String(spec.y_axis))) {
    errors.push(`Niedozwolone y_axis: ${spec.y_axis}`);
  }
  if (spec.group_by && !ALLOWED_GROUP_BY.includes(String(spec.group_by))) {
    errors.push(`Niedozwolone group_by: ${spec.group_by}`);
  }
  if (!ALLOWED_CHART_TYPES.includes(String(spec.chart_type))) {
    errors.push(`Niedozwolony chart_type: ${spec.chart_type}`);
  }
  if (!ALLOWED_GRANULARITIES.includes(String(spec.granularity))) {
    errors.push(`Niedozwolona granularity: ${spec.granularity}`);
  }
  for (const f of spec.filters_advanced || []) {
    if (!FILTERABLE_FIELDS.includes(f.field)) {
      errors.push(`Niedozwolone pole filtra: ${f.field}`);
    }
    if (!ALLOWED_FILTER_OPERATORS.includes(f.operator)) {
      errors.push(`Niedozwolony operator filtra: ${f.operator}`);
    }
  }
  return errors;
}
