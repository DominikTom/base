import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  ALLOWED_X_AXES, ALLOWED_Y_AXES, ALLOWED_GROUP_BY, FILTERABLE_FIELDS,
  measureDataset, META_ACCOUNT_TO_SHOP,
} from '@/lib/explorer-whitelist';
import { fetchEurRatesByDate, gaToPln } from '@/lib/ad-cost';

type ExplorerFilterOperator = 'eq' | 'neq' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'is_null' | 'not_null';

interface ExplorerFilter {
  field: string;
  operator: ExplorerFilterOperator;
  value?: string | number | boolean | Array<string | number>;
  value_to?: string | number;
}

// Wymiary z poziomu pozycji zamówienia.
const ITEM_LEVEL_DIMS = new Set(['product_category', 'fabric_collection', 'bed_size', 'mattress_type', 'headboard_height']);
// Pola filtrów dotyczące pozycji (wymagają dociągnięcia v_order_items).
const ITEM_FILTER_FIELDS = new Set(['product_name', 'product_category', 'fabric_collection', 'fabric', 'bed_size', 'mattress_type', 'headboard_height', 'storage_type', 'quantity', 'is_sample']);

interface ExplorerParams {
  x_axis: string; y_axis: string; group_by?: string;
  date_from: string; date_to: string;
  filters: Record<string, string[]>;
  granularity: string;
  advancedFilters: ExplorerFilter[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      x_axis = 'date',
      y_axis = 'revenue_gross',
      group_by,
      date_from = '2025-01-01',
      date_to = new Date().toISOString().split('T')[0],
      filters = {},
      granularity = 'day',
      filters_advanced = [],
    } = body;
    const advancedFilters = Array.isArray(filters_advanced) ? filters_advanced as ExplorerFilter[] : [];

    for (const f of advancedFilters) {
      if (!FILTERABLE_FIELDS.includes(f.field)) {
        return NextResponse.json({ error: `Invalid filter field: ${f.field}` }, { status: 400 });
      }
    }
    if (!ALLOWED_X_AXES.includes(x_axis)) return NextResponse.json({ error: `Invalid x_axis: ${x_axis}` }, { status: 400 });
    if (!ALLOWED_Y_AXES.includes(y_axis)) return NextResponse.json({ error: `Invalid y_axis: ${y_axis}` }, { status: 400 });
    if (group_by && !ALLOWED_GROUP_BY.includes(group_by)) return NextResponse.json({ error: `Invalid group_by: ${group_by}` }, { status: 400 });

    const params: ExplorerParams = { x_axis, y_axis, group_by, date_from, date_to, filters, granularity, advancedFilters };
    const dataset = measureDataset(y_axis);
    if (dataset === 'meta') return handleMetaAdsExplorer(params);
    if (dataset === 'traffic') return handleTrafficExplorer(params);
    return handleOrderExplorer(params);
  } catch (err) {
    console.error('Explorer API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function dateKey(dateStr: string, granularity: string): string {
  const d = new Date(dateStr);
  switch (granularity) {
    case 'week': {
      const sw = new Date(d);
      sw.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return sw.toISOString().split('T')[0];
    }
    case 'month': return dateStr.substring(0, 7);
    case 'quarter': return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    default: return dateStr.substring(0, 10);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dimValueOrder(dim: string, item: any, order: any, granularity: string): string {
  switch (dim) {
    case 'date': return dateKey(order?.order_date || '', granularity);
    case 'source_shop': return order?.source_shop || 'unknown';
    case 'source_platform': return order?.source_platform || 'unknown';
    case 'supplier': return order?.supplier || 'Brak';
    case 'delivery_city': return order?.delivery_city || 'Brak';
    case 'status': return order?.status || 'unknown';
    case 'coupon_code': return order?.coupon_code || 'Brak';
    case 'product_category': return (item?.product_category as string) || 'Brak';
    case 'fabric_collection': return (item?.fabric_collection as string) || 'Brak';
    case 'bed_size': return (item?.bed_size as string) || 'Brak';
    case 'mattress_type': return (item?.mattress_type as string) || 'Brak';
    case 'headboard_height': return (item?.headboard_height as string) || 'Brak';
    default: return 'unknown';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchItems(db: any, orderIds: string[]): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  const CHUNK = 300;
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const chunk = orderIds.slice(i, i + CHUNK);
    const { data } = await db
      .from('v_order_items')
      .select('order_id, product_name, product_category, fabric_collection, fabric, bed_size, mattress_type, headboard_height, storage_type, quantity, is_sample')
      .in('order_id', chunk)
      .not('item_type', 'in', '("shipping","service","surcharge")')
      .limit(20000);
    if (data) out.push(...data);
  }
  return out;
}

// ============================================================
// DATASET: orders (fact_orders + v_order_items)
// Miary: revenue_gross, orders_count, avg_order_value, quantity,
//        revenue_paid, orders_paid, orders_cancelled, shipping_revenue
// ============================================================
async function handleOrderExplorer(params: ExplorerParams) {
  const db = getSupabaseAdmin();
  let query = db
    .from('fact_orders')
    .select('order_id, order_date, source_shop, source_platform, supplier, total_gross_pln, shipping_cost_pln, is_paid, status, delivery_city, coupon_code')
    .gte('order_date', params.date_from)
    .lte('order_date', params.date_to + 'T23:59:59');

  if (params.filters.shop?.length) query = query.in('source_shop', params.filters.shop);
  if (params.filters.supplier?.length) query = query.in('supplier', params.filters.supplier);
  if (params.filters.status?.length) query = query.in('status', params.filters.status);
  query = applySupabaseFilters(query, params.advancedFilters, ['source_shop', 'source_platform', 'supplier', 'status', 'delivery_city', 'coupon_code', 'total_gross_pln']);

  const { data: ordersRaw, error } = await query.limit(50000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const orders = ordersRaw || [];

  const xItem = ITEM_LEVEL_DIMS.has(params.x_axis);
  const gItem = ITEM_LEVEL_DIMS.has(params.group_by || '');
  const hasItemFilter = params.advancedFilters.some(f => ITEM_FILTER_FIELDS.has(f.field));
  const needItems = xItem || gItem || hasItemFilter || params.y_axis === 'quantity';

  let items: Array<Record<string, unknown>> = [];
  if (needItems && orders.length) {
    items = await fetchItems(db, orders.map((o: { order_id: string }) => o.order_id));
  }

  const orderIdFilter = buildOrderIdFilterFromItemFilters(params.advancedFilters, items);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orderById = new Map<string, any>(orders.map((o: { order_id: string }) => [o.order_id, o]));
  const filteredOrders = orderIdFilter ? orders.filter((o: { order_id: string }) => orderIdFilter.has(o.order_id)) : orders;
  const filteredOrderIds = new Set(filteredOrders.map((o: { order_id: string }) => o.order_id));

  // sztuki per zamówienie
  const qtyByOrder: Record<string, number> = {};
  for (const it of items) {
    const oid = String(it.order_id);
    qtyByOrder[oid] = (qtyByOrder[oid] || 0) + (Number(it.quantity) || 0);
  }

  type Agg = {
    revenue: number; revenuePaid: number; shipping: number; quantity: number;
    orderIds: Set<string>; orderIdsPaid: Set<string>; orderIdsCancelled: Set<string>;
  };
  const grouped: Record<string, Record<string, Agg>> = {};
  function bucket(xKey: string, gKey: string): Agg {
    if (!grouped[xKey]) grouped[xKey] = {};
    if (!grouped[xKey][gKey]) grouped[xKey][gKey] = {
      revenue: 0, revenuePaid: 0, shipping: 0, quantity: 0,
      orderIds: new Set(), orderIdsPaid: new Set(), orderIdsCancelled: new Set(),
    };
    return grouped[xKey][gKey];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function addOrderToAgg(agg: Agg, order: any, qtyShare: number = 1) {
    const gross = Number(order.total_gross_pln) || 0;
    const ship = Number(order.shipping_cost_pln) || 0;
    agg.revenue += gross * qtyShare;
    agg.shipping += ship * qtyShare;
    if (order.is_paid) agg.revenuePaid += gross * qtyShare;
    agg.orderIds.add(order.order_id);
    if (order.is_paid) agg.orderIdsPaid.add(order.order_id);
    if (typeof order.status === 'string' && /cancel|anulow/i.test(order.status)) {
      agg.orderIdsCancelled.add(order.order_id);
    }
  }

  const itemGrain = xItem || gItem;
  if (itemGrain) {
    for (const it of items) {
      const oid = String(it.order_id);
      if (!filteredOrderIds.has(oid)) continue;
      const order = orderById.get(oid);
      if (!order) continue;
      const xKey = dimValueOrder(params.x_axis, it, order, params.granularity);
      const gKey = params.group_by ? dimValueOrder(params.group_by, it, order, params.granularity) : 'total';
      const agg = bucket(xKey, gKey);
      const itemQty = Number(it.quantity) || 0;
      agg.quantity += itemQty;
      const totalQty = qtyByOrder[oid] || 0;
      const share = totalQty > 0 ? itemQty / totalQty : 0;
      addOrderToAgg(agg, order, share);
    }
  } else {
    for (const order of filteredOrders) {
      const xKey = dimValueOrder(params.x_axis, null, order, params.granularity);
      const gKey = params.group_by ? dimValueOrder(params.group_by, null, order, params.granularity) : 'total';
      const agg = bucket(xKey, gKey);
      agg.quantity += qtyByOrder[order.order_id] || 0;
      addOrderToAgg(agg, order, 1);
    }
  }

  const groups = new Set<string>();
  for (const vals of Object.values(grouped)) for (const g of Object.keys(vals)) groups.add(g);

  function measure(agg: Agg): number {
    const orderCount = agg.orderIds.size;
    switch (params.y_axis) {
      case 'orders_count': return orderCount;
      case 'avg_order_value': return orderCount > 0 ? agg.revenue / orderCount : 0;
      case 'quantity': return agg.quantity;
      case 'revenue_paid': return agg.revenuePaid;
      case 'orders_paid': return agg.orderIdsPaid.size;
      case 'orders_cancelled': return agg.orderIdsCancelled.size;
      case 'shipping_revenue': return agg.shipping;
      case 'revenue_gross':
      default: return agg.revenue;
    }
  }

  return buildResponse(grouped, groups, measure, params);
}

// ============================================================
// DATASET: meta_ads (fact_daily_adspend WHERE platform='meta')
// Miary: meta_spend, meta_impressions, meta_clicks, meta_conversions, meta_ctr, meta_cpc
// ============================================================
async function handleMetaAdsExplorer(params: ExplorerParams) {
  const db = getSupabaseAdmin();
  let q = db.from('fact_daily_adspend')
    .select('date, account_id, spend, conversion_value, impressions, clicks, conversions')
    .eq('platform', 'meta')
    .gte('date', params.date_from)
    .lte('date', params.date_to);

  const shopFilter = collectShopFilter(params);
  if (shopFilter.length) {
    const accounts = Object.entries(META_ACCOUNT_TO_SHOP)
      .filter(([, shop]) => shopFilter.includes(shop))
      .map(([id]) => id);
    if (accounts.length) q = q.in('account_id', accounts);
    else return emptyResponse(params); // wybrany sklep nie ma konta Meta
  }
  const { data: rows, error } = await q.limit(50000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type AggA = { spend: number; revenue: number; impressions: number; clicks: number; conversions: number };
  const grouped: Record<string, Record<string, AggA>> = {};
  function bucket(xKey: string, gKey: string): AggA {
    if (!grouped[xKey]) grouped[xKey] = {};
    if (!grouped[xKey][gKey]) grouped[xKey][gKey] = { spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0 };
    return grouped[xKey][gKey];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function dim(d: string, r: any): string {
    switch (d) {
      case 'date': return dateKey(r.date, params.granularity);
      case 'source_shop': return META_ACCOUNT_TO_SHOP[r.account_id] || 'Inne';
      case 'source_platform': return 'meta';
      default: return 'Łącznie';
    }
  }

  for (const r of rows || []) {
    const xKey = dim(params.x_axis, r);
    const gKey = params.group_by ? dim(params.group_by, r) : 'total';
    const agg = bucket(xKey, gKey);
    agg.spend += Number(r.spend) || 0;
    agg.revenue += Number(r.conversion_value) || 0;
    agg.impressions += Number(r.impressions) || 0;
    agg.clicks += Number(r.clicks) || 0;
    agg.conversions += Number(r.conversions) || 0;
  }

  const groups = new Set<string>();
  for (const vals of Object.values(grouped)) for (const g of Object.keys(vals)) groups.add(g);

  function measure(a: AggA): number {
    switch (params.y_axis) {
      case 'meta_spend': return a.spend;
      case 'meta_revenue': return a.revenue;
      case 'meta_impressions': return a.impressions;
      case 'meta_clicks': return a.clicks;
      case 'meta_conversions': return a.conversions;
      case 'meta_ctr': return a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
      case 'meta_cpc': return a.clicks > 0 ? a.spend / a.clicks : 0;
      case 'meta_roas': return a.spend > 0 ? a.revenue / a.spend : 0;
      default: return 0;
    }
  }

  return buildResponse(grouped, groups, measure, params);
}

// ============================================================
// DATASET: traffic (fact_daily_traffic WHERE source='__total__')
// Miary: google_spend, sessions, users, transactions, ga_revenue, pageviews
// ============================================================
async function handleTrafficExplorer(params: ExplorerParams) {
  const db = getSupabaseAdmin();
  let q = db.from('fact_daily_traffic')
    .select('date, hostname, sessions, users, transactions, ga_revenue, pageviews, ad_cost')
    .eq('source', '__total__')
    .gte('date', params.date_from)
    .lte('date', params.date_to);

  const shopFilter = collectShopFilter(params);
  if (shopFilter.length) q = q.in('hostname', shopFilter);

  const { data: rows, error } = await q.limit(50000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ad_cost i ga_revenue trzymane są w walucie property GA4 (mybed.de = EUR).
  // Konwertujemy do PLN per dzień przez kursy z fact_orders.exchange_rate.
  const rates = await fetchEurRatesByDate(db, params.date_from, params.date_to);

  type AggT = { sessions: number; users: number; transactions: number; ga_revenue: number; pageviews: number; ad_cost: number };
  const grouped: Record<string, Record<string, AggT>> = {};
  function bucket(xKey: string, gKey: string): AggT {
    if (!grouped[xKey]) grouped[xKey] = {};
    if (!grouped[xKey][gKey]) grouped[xKey][gKey] = { sessions: 0, users: 0, transactions: 0, ga_revenue: 0, pageviews: 0, ad_cost: 0 };
    return grouped[xKey][gKey];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function dim(d: string, r: any): string {
    switch (d) {
      case 'date': return dateKey(r.date, params.granularity);
      case 'source_shop': return r.hostname || 'unknown';
      case 'source_platform': return 'google';
      default: return 'Łącznie';
    }
  }

  for (const r of rows || []) {
    const xKey = dim(params.x_axis, r);
    const gKey = params.group_by ? dim(params.group_by, r) : 'total';
    const agg = bucket(xKey, gKey);
    agg.sessions += Number(r.sessions) || 0;
    agg.users += Number(r.users) || 0;
    agg.transactions += Number(r.transactions) || 0;
    agg.pageviews += Number(r.pageviews) || 0;
    const dateStr = String(r.date);
    agg.ga_revenue += gaToPln(r.hostname, Number(r.ga_revenue) || 0, dateStr, rates);
    agg.ad_cost += gaToPln(r.hostname, Number(r.ad_cost) || 0, dateStr, rates);
  }

  const groups = new Set<string>();
  for (const vals of Object.values(grouped)) for (const g of Object.keys(vals)) groups.add(g);

  function measure(a: AggT): number {
    switch (params.y_axis) {
      case 'google_spend': return a.ad_cost;
      case 'sessions': return a.sessions;
      case 'users': return a.users;
      case 'transactions': return a.transactions;
      case 'ga_revenue': return a.ga_revenue;
      case 'pageviews': return a.pageviews;
      default: return 0;
    }
  }

  return buildResponse(grouped, groups, measure, params);
}

// ============================================================
// Wspólne pomocniki
// ============================================================

// Filtr sklepu z params.filters.shop + advancedFilters (source_shop eq/in).
function collectShopFilter(params: ExplorerParams): string[] {
  const out = new Set<string>(params.filters.shop || []);
  for (const f of params.advancedFilters) {
    if (f.field !== 'source_shop') continue;
    if (f.operator === 'eq' && f.value) out.add(String(f.value));
    else if (f.operator === 'in') {
      const arr = Array.isArray(f.value) ? f.value : String(f.value || '').split(',').map(v => v.trim()).filter(Boolean);
      for (const v of arr) out.add(String(v));
    }
  }
  return [...out];
}

function emptyResponse(params: ExplorerParams) {
  return NextResponse.json({
    data: [], groups: [],
    meta: { total_rows: 0, date_range: { from: params.date_from, to: params.date_to } },
  });
}

function buildResponse<A>(
  grouped: Record<string, Record<string, A>>,
  groups: Set<string>,
  measure: (a: A) => number,
  params: ExplorerParams,
) {
  const chartData = Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => ({
      x: key,
      ...Object.fromEntries([...groups].map(g => [g, values[g] ? Math.round(measure(values[g])) : 0])),
    }));
  return NextResponse.json({
    data: chartData,
    groups: [...groups],
    meta: { total_rows: chartData.length, date_range: { from: params.date_from, to: params.date_to } },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySupabaseFilters(query: any, filters: ExplorerFilter[], allowedFields: string[]) {
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
      case 'between': if (f.value != null && f.value_to != null) query = query.gte(f.field, f.value).lte(f.field, f.value_to); break;
      case 'is_null': query = query.is(f.field, null); break;
      case 'not_null': query = query.not(f.field, 'is', null); break;
    }
  }
  return query;
}

function buildOrderIdFilterFromItemFilters(filters: ExplorerFilter[], items: Array<Record<string, unknown>>): Set<string> | null {
  const itemFilters = filters.filter(f => ITEM_FILTER_FIELDS.has(f.field));
  if (!itemFilters.length) return null;
  const matching = items.filter(item => itemFilters.every(f => matchFilter(item[f.field], f)));
  return new Set(matching.map(r => String(r.order_id)));
}

function matchFilter(raw: unknown, filter: ExplorerFilter): boolean {
  const value = raw == null ? '' : String(raw);
  const fv = filter.value;
  switch (filter.operator) {
    case 'eq': return value === String(fv ?? '');
    case 'neq': return value !== String(fv ?? '');
    case 'contains': return value.toLowerCase().includes(String(fv ?? '').toLowerCase());
    case 'not_contains': return !value.toLowerCase().includes(String(fv ?? '').toLowerCase());
    case 'starts_with': return value.toLowerCase().startsWith(String(fv ?? '').toLowerCase());
    case 'ends_with': return value.toLowerCase().endsWith(String(fv ?? '').toLowerCase());
    case 'in': {
      const arr = Array.isArray(fv) ? fv.map(v => String(v)) : String(fv || '').split(',').map(v => v.trim()).filter(Boolean);
      return arr.includes(value);
    }
    case 'is_null': return raw == null;
    case 'not_null': return raw != null;
    case 'gt': return Number(raw) > Number(fv);
    case 'gte': return Number(raw) >= Number(fv);
    case 'lt': return Number(raw) < Number(fv);
    case 'lte': return Number(raw) <= Number(fv);
    case 'between': return Number(raw) >= Number(fv) && Number(raw) <= Number(filter.value_to);
    default: return true;
  }
}
