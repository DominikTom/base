import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { ALLOWED_X_AXES, ALLOWED_Y_AXES, ALLOWED_GROUP_BY, FILTERABLE_FIELDS } from '@/lib/explorer-whitelist';

type ExplorerFilterOperator = 'eq' | 'neq' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'is_null' | 'not_null';

interface ExplorerFilter {
  field: string;
  operator: ExplorerFilterOperator;
  value?: string | number | boolean | Array<string | number>;
  value_to?: string | number;
}

// Wymiary z poziomu pozycji zamówienia (nie zamówienia).
const ITEM_LEVEL_DIMS = new Set(['product_category', 'fabric_collection']);
// Pola filtrów dotyczące pozycji (wymagają dociągnięcia v_order_items).
const ITEM_FILTER_FIELDS = new Set(['product_name', 'product_category', 'fabric_collection', 'fabric', 'bed_size', 'headboard_height', 'storage_type', 'quantity', 'is_sample']);

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
    if (!ALLOWED_X_AXES.includes(x_axis)) {
      return NextResponse.json({ error: `Invalid x_axis: ${x_axis}` }, { status: 400 });
    }
    if (!ALLOWED_Y_AXES.includes(y_axis)) {
      return NextResponse.json({ error: `Invalid y_axis: ${y_axis}` }, { status: 400 });
    }
    if (group_by && !ALLOWED_GROUP_BY.includes(group_by)) {
      return NextResponse.json({ error: `Invalid group_by: ${group_by}` }, { status: 400 });
    }

    return handleExplorer({ x_axis, y_axis, group_by, date_from, date_to, filters, granularity, advancedFilters });
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
function dimValue(dim: string, item: any, order: any, granularity: string): string {
  switch (dim) {
    case 'date': return dateKey(order?.order_date || '', granularity);
    case 'source_shop': return order?.source_shop || 'unknown';
    case 'source_platform': return order?.source_platform || 'unknown';
    case 'supplier': return order?.supplier || 'Brak';
    case 'product_category': return (item?.product_category as string) || 'Brak';
    case 'fabric_collection': return (item?.fabric_collection as string) || 'Brak';
    default: return 'unknown';
  }
}

// Dociąga pozycje (v_order_items) dla zadanych zamówień, w paczkach —
// .in() z tysiącami id rozsadziłoby długość zapytania.
async function fetchItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  orderIds: string[],
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  const CHUNK = 300;
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const chunk = orderIds.slice(i, i + CHUNK);
    const { data } = await db
      .from('v_order_items')
      .select('order_id, product_name, product_category, fabric_collection, fabric, bed_size, headboard_height, storage_type, quantity, is_sample')
      .in('order_id', chunk)
      .not('item_type', 'in', '("shipping","service","surcharge")')
      .limit(20000);
    if (data) out.push(...data);
  }
  return out;
}

interface ExplorerParams {
  x_axis: string; y_axis: string; group_by?: string;
  date_from: string; date_to: string;
  filters: Record<string, string[]>;
  granularity: string;
  advancedFilters: ExplorerFilter[];
}

// Jedna ścieżka zapytań: zawsze fact_orders (+ v_order_items, gdy potrzebne).
// fact_daily_revenue jest puste, dlatego nie używamy go już wcale.
async function handleExplorer(params: ExplorerParams) {
  const db = getSupabaseAdmin();

  // 1. Zamówienia
  let query = db
    .from('fact_orders')
    .select('order_id, order_date, source_shop, source_platform, supplier, total_gross_pln, status')
    .gte('order_date', params.date_from)
    .lte('order_date', params.date_to + 'T23:59:59');

  if (params.filters.shop?.length) query = query.in('source_shop', params.filters.shop);
  if (params.filters.supplier?.length) query = query.in('supplier', params.filters.supplier);
  if (params.filters.status?.length) query = query.in('status', params.filters.status);
  query = applySupabaseFilters(query, params.advancedFilters, ['source_shop', 'source_platform', 'supplier', 'status', 'delivery_city', 'coupon_code', 'total_gross_pln']);

  const { data: ordersRaw, error } = await query.limit(50000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const orders = ordersRaw || [];

  // 2. Pozycje — gdy wymiar/grupowanie jest na poziomie pozycji, gdy mierzymy
  //    ilość sztuk, albo gdy jest filtr dotyczący pozycji.
  const xItem = ITEM_LEVEL_DIMS.has(params.x_axis);
  const gItem = ITEM_LEVEL_DIMS.has(params.group_by || '');
  const hasItemFilter = params.advancedFilters.some(f => ITEM_FILTER_FIELDS.has(f.field));
  const needItems = xItem || gItem || hasItemFilter || params.y_axis === 'quantity';

  let items: Array<Record<string, unknown>> = [];
  if (needItems && orders.length) {
    items = await fetchItems(db, orders.map((o: { order_id: string }) => o.order_id));
  }

  // 3. Filtr pozycji → zawężenie zamówień
  const orderIdFilter = buildOrderIdFilterFromItemFilters(params.advancedFilters, items);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orderById = new Map<string, any>(orders.map((o: { order_id: string }) => [o.order_id, o]));
  const filteredOrders = orderIdFilter ? orders.filter((o: { order_id: string }) => orderIdFilter.has(o.order_id)) : orders;
  const filteredOrderIds = new Set(filteredOrders.map((o: { order_id: string }) => o.order_id));

  // Suma sztuk na zamówienie (do alokacji przychodu i miary "quantity").
  const qtyByOrder: Record<string, number> = {};
  for (const it of items) {
    const oid = String(it.order_id);
    qtyByOrder[oid] = (qtyByOrder[oid] || 0) + (Number(it.quantity) || 0);
  }

  type Agg = { revenue: number; orderIds: Set<string>; quantity: number };
  const grouped: Record<string, Record<string, Agg>> = {};
  function bucket(xKey: string, gKey: string): Agg {
    if (!grouped[xKey]) grouped[xKey] = {};
    if (!grouped[xKey][gKey]) grouped[xKey][gKey] = { revenue: 0, orderIds: new Set(), quantity: 0 };
    return grouped[xKey][gKey];
  }

  const itemGrain = xItem || gItem;
  if (itemGrain) {
    // Ziarno pozycji — przychód alokujemy proporcjonalnie do liczby sztuk
    // w zamówieniu (zamówienia są wieloliniowe, brak ceny per linia).
    for (const it of items) {
      const oid = String(it.order_id);
      if (!filteredOrderIds.has(oid)) continue;
      const order = orderById.get(oid);
      if (!order) continue;
      const xKey = dimValue(params.x_axis, it, order, params.granularity);
      const gKey = params.group_by ? dimValue(params.group_by, it, order, params.granularity) : 'total';
      const agg = bucket(xKey, gKey);
      const itemQty = Number(it.quantity) || 0;
      agg.quantity += itemQty;
      agg.orderIds.add(oid);
      const totalQty = qtyByOrder[oid] || 0;
      if (totalQty > 0) agg.revenue += (Number(order.total_gross_pln) || 0) * (itemQty / totalQty);
    }
  } else {
    // Ziarno zamówienia
    for (const order of filteredOrders) {
      const xKey = dimValue(params.x_axis, null, order, params.granularity);
      const gKey = params.group_by ? dimValue(params.group_by, null, order, params.granularity) : 'total';
      const agg = bucket(xKey, gKey);
      agg.revenue += Number(order.total_gross_pln) || 0;
      agg.orderIds.add(order.order_id);
      agg.quantity += qtyByOrder[order.order_id] || 0;
    }
  }

  const groups = new Set<string>();
  for (const vals of Object.values(grouped)) {
    for (const g of Object.keys(vals)) groups.add(g);
  }

  function measure(agg: Agg): number {
    const orderCount = agg.orderIds.size;
    switch (params.y_axis) {
      case 'orders_count': return orderCount;
      case 'avg_order_value': return orderCount > 0 ? agg.revenue / orderCount : 0;
      case 'quantity': return agg.quantity;
      case 'revenue_gross':
      default: return agg.revenue;
    }
  }

  const chartData = Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => ({
      x: key,
      ...Object.fromEntries([...groups].map(g => [g, values[g] ? Math.round(measure(values[g])) : 0])),
    }));

  return NextResponse.json({
    data: chartData,
    groups: [...groups],
    meta: {
      total_rows: chartData.length,
      date_range: { from: params.date_from, to: params.date_to },
    },
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
