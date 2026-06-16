export interface FactOrder {
  order_id: string;
  order_date: string;
  expected_date: string | null;
  fulfillment_date: string | null;
  source_platform: string;
  source_shop: string;
  currency: string;
  total_gross: number | null;
  shipping_cost: number | null;
  exchange_rate: number;
  total_gross_pln: number | null;
  shipping_cost_pln: number | null;
  is_paid: boolean;
  coupon_code: string | null;
  status: string;
  customer_name: string | null;
  customer_email_hash: string | null;
  delivery_city: string | null;
  delivery_zip: string | null;
  delivery_method: string | null;
  supplier: string | null;
  production_batch: string | null;
  sales_person: string | null;
  marketplace_tag: string | null;
  operational_tags: string[];
  invoice_production: string | null;
  invoice_mattress: string | null;
  invoice_transport: string | null;
  notes: string | null;
  // Idempotency / change tracking — set by parser, used by upsert RPC.
  row_hash?: string;
}

export interface FactOrderItem {
  order_id: string;
  line_number: number;
  product_name: string;
  product_category: string;
  quantity: number;
  item_type: string;
  bed_size: string | null;
  mattress_type: string | null;
  fabric: string | null;
  fabric_collection: string | null;
  headboard_height: string | null;
  storage_type: string | null;
  headboard_type: string | null;
  bed_side: string | null;
  storage_opening: string | null;
  mattress_hardness: string | null;
  pillows_choice: string | null;
  duvet_choice: string | null;
  legs_type: string | null;
  raw_options: string | null;
  options_language: string | null;
}

export interface DailyRevenue {
  date: string;
  source_shop: string;
  orders_count: number;
  orders_paid: number;
  orders_cancelled: number;
  revenue_gross_pln: number;
  revenue_paid_pln: number;
  shipping_revenue_pln: number;
  avg_order_value_pln: number;
  revenue_gross_original: number;
  original_currency: string;
  revenue_beds: number;
  revenue_mattresses: number;
  revenue_accessories: number;
  revenue_furniture: number;
  revenue_other: number;
}

export interface DailyAdSpend {
  date: string;
  platform: string;
  campaign_id: string;
  campaign_name: string | null;
  adset_name: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  conversion_value: number;
  cpc: number | null;
  cpm: number | null;
  ctr: number | null;
  roas: number | null;
}

export interface DailyTraffic {
  date: string;
  source: string;
  medium: string;
  campaign: string | null;
  hostname: string;
  sessions: number;
  users: number;
  new_users: number;
  pageviews: number;
  bounce_rate: number | null;
  avg_session_duration: number | null;
  transactions: number;
  ga_revenue: number;
}

export interface EtlLog {
  id: number;
  source: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  rows_processed: number;
  rows_inserted: number;
  rows_updated: number;
  rows_deleted: number;
  error_message: string | null;
  csv_filename: string | null;
  date_range_start: string | null;
  date_range_end: string | null;
}

// Pojedynczy sklep — dla UI list / etykiet. 'all' to legacy/wildcard.
// W praktyce filtrujemy do MyBed Group: mybed.pl, mybed.de, mittohome.pl.
// Pozostałe (amazon.de, allegro.pl, showroom, kaufland.de) ukryte z UI.
export type Shop = 'all' | 'mybed.pl' | 'mybed.de' | 'mittohome.pl';
export type CompareMode = 'none' | 'mom' | 'yoy' | 'previous_period';
export type Granularity = 'day' | 'week' | 'month' | 'quarter';

// filters.shop — string (nie sam Shop), bo multi-select serializuje wybrane
// sklepy jako CSV ('mybed.pl,mybed.de'). Helpers w lib/shop-filter.ts
// (shopFilterToList, applyShopFilter, shopFilterLabel) parsują tę wartość.
//   - 'all'                 → brak filtru (wszystkie sklepy)
//   - 'mybed.pl'            → pojedynczy sklep
//   - 'mybed.pl,mybed.de'   → multi-select
export interface DashboardFilters {
  dateFrom: string;
  dateTo: string;
  shop: string;
  compare: CompareMode;
}
