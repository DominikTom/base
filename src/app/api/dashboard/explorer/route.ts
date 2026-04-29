import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

type ExplorerFilterOperator = 'eq' | 'neq' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'is_null' | 'not_null';

interface ExplorerFilter {
  field: string;
  operator: ExplorerFilterOperator;
  value?: string | number | boolean | Array<string | number>;
  value_to?: string | number;
}

const FILTERABLE_FIELDS = [
  'source_shop', 'source_platform', 'supplier', 'status', 'delivery_city', 'coupon_code',
  'product_name', 'product_category', 'fabric_collection', 'fabric', 'bed_size', 'headboard_height', 'storage_type',
  'total_gross_pln', 'quantity',
];

// Whitelist of allowed columns for security
const ALLOWED_X_AXES = ['date', 'source_shop', 'product_category', 'fabric_collection', 'supplier', 'source_platform'];
const ALLOWED_Y_AXES = ['revenue_gross', 'orders_count', 'avg_order_value', 'quantity'];
const ALLOWED_GROUP_BY = ['source_shop', 'product_category', 'supplier', 'source_platform', 'fabric_collection'];

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

    // Validate inputs
    if (!ALLOWED_X_AXES.includes(x_axis)) {
      return NextResponse.json({ error: `Invalid x_axis: ${x_axis}` }, { status: 400 });
    }
    if (!ALLOWED_Y_AXES.includes(y_axis)) {
      return NextResponse.json({ error: `Invalid y_axis: ${y_axis}` }, { status: 400 });
    }
    if (group_by && !ALLOWED_GROUP_BY.includes(group_by)) {
      return NextResponse.json({ error: `Invalid group_by: ${group_by}` }, { status: 400 });
    }

    // Decide which table to query
    if (x_axis === 'date' && ['revenue_gross', 'orders_count', 'avg_order_value'].includes(y_axis)) {
      // Use fact_daily_revenue
      return handleRevenueExplorer({ x_axis, y_axis, group_by, date_from, date_to, filters, granularity, advancedFilters });
    }

    // Use fact_orders + fact_order_items
    return handleOrderExplorer({ x_axis, y_axis, group_by, date_from, date_to, filters, granularity, advancedFilters });
  } catch (err) {
    console.error('Explorer API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function handleRevenueExplorer(params: {
  x_axis: string; y_axis: string; group_by?: string;
  date_from: string; date_to: string; filters: Record<string, string[]>;
  granularity: string;
  advancedFilters: ExplorerFilter[];
}) {
  let query = getSupabaseAdmin()
    .from('fact_daily_revenue')
    .select('*')
    .gte('date', params.date_from)
    .lte('date', params.date_to)
    .order('date', { ascending: true });

  if (params.filters.shop?.length) {
    query = query.in('source_shop', params.filters.shop);
  }

  query = applySupabaseFilters(query, params.advancedFilters, ['source_shop', 'source_platform', 'supplier', 'status']);

  const { data, error } = await query.limit(50000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Group by granularity
  function getKey(date: string): string {
    const d = new Date(date);
    switch (params.granularity) {
      case 'week': {
        const sw = new Date(d);
        sw.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        return sw.toISOString().split('T')[0];
      }
      case 'month': return date.substring(0, 7);
      case 'quarter': return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
      default: return date;
    }
  }

  const grouped: Record<string, Record<string, number>> = {};
  for (const row of data || []) {
    const xKey = getKey(row.date);
    const gKey = params.group_by ? (row as Record<string, unknown>)[params.group_by] as string || 'unknown' : 'total';

    if (!grouped[xKey]) grouped[xKey] = {};

    let value = 0;
    switch (params.y_axis) {
      case 'revenue_gross': value = row.revenue_gross_pln || 0; break;
      case 'orders_count': value = row.orders_count || 0; break;
      case 'avg_order_value': value = row.avg_order_value_pln || 0; break;
    }

    grouped[xKey][gKey] = (grouped[xKey][gKey] || 0) + value;
  }

  // For AOV, recompute the average
  if (params.y_axis === 'avg_order_value') {
    const revGrouped: Record<string, Record<string, number>> = {};
    const countGrouped: Record<string, Record<string, number>> = {};
    for (const row of data || []) {
      const xKey = getKey(row.date);
      const gKey = params.group_by ? (row as Record<string, unknown>)[params.group_by] as string || 'unknown' : 'total';
      if (!revGrouped[xKey]) revGrouped[xKey] = {};
      if (!countGrouped[xKey]) countGrouped[xKey] = {};
      revGrouped[xKey][gKey] = (revGrouped[xKey][gKey] || 0) + (row.revenue_gross_pln || 0);
      countGrouped[xKey][gKey] = (countGrouped[xKey][gKey] || 0) + (row.orders_count || 0);
    }
    for (const xKey of Object.keys(grouped)) {
      for (const gKey of Object.keys(grouped[xKey])) {
        const count = countGrouped[xKey]?.[gKey] || 0;
        const rev = revGrouped[xKey]?.[gKey] || 0;
        grouped[xKey][gKey] = count > 0 ? Math.round(rev / count) : 0;
      }
    }
  }

  const groups = new Set<string>();
  for (const vals of Object.values(grouped)) {
    for (const g of Object.keys(vals)) groups.add(g);
  }

  const chartData = Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => ({
      x: key,
      ...Object.fromEntries([...groups].map(g => [g, Math.round(values[g] || 0)])),
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

async function handleOrderExplorer(params: {
  x_axis: string; y_axis: string; group_by?: string;
  date_from: string; date_to: string; filters: Record<string, string[]>;
  granularity: string;
  advancedFilters: ExplorerFilter[];
}) {
  let query = getSupabaseAdmin()
    .from('fact_orders')
    .select('order_id, order_date, source_shop, source_platform, supplier, total_gross_pln, status')
    .gte('order_date', params.date_from)
    .lte('order_date', params.date_to + 'T23:59:59');

  if (params.filters.shop?.length) {
    query = query.in('source_shop', params.filters.shop);
  }
  if (params.filters.supplier?.length) {
    query = query.in('supplier', params.filters.supplier);
  }
  if (params.filters.status?.length) {
    query = query.in('status', params.filters.status);
  }

  query = applySupabaseFilters(query, params.advancedFilters, ['source_shop', 'source_platform', 'supplier', 'status', 'delivery_city', 'coupon_code', 'total_gross_pln']);

  const { data: orders, error } = await query.limit(50000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // For product-level/grouping OR item-scoped advanced filters, we need items too
  let items: Array<Record<string, unknown>> = [];
  const itemFilterFields = new Set(['product_name', 'product_category', 'fabric_collection', 'fabric', 'bed_size', 'headboard_height', 'storage_type', 'quantity']);
  const hasItemScopedFilter = params.advancedFilters.some(f => itemFilterFields.has(f.field));
  if (['product_category', 'fabric_collection'].includes(params.x_axis) ||
      ['product_category', 'fabric_collection'].includes(params.group_by || '') ||
      hasItemScopedFilter) {
    const { data: itemData } = await getSupabaseAdmin()
      .from('fact_order_items')
      .select('order_id, product_name, product_category, fabric_collection, fabric, bed_size, headboard_height, storage_type, quantity')
      .in('order_id', (orders || []).map(o => o.order_id))
      .not('item_type', 'in', '("shipping","service","surcharge")')
      .limit(50000);
    items = itemData || [];
  }

  const orderIdFilter = buildOrderIdFilterFromItemFilters(params.advancedFilters, items);
  const filteredOrders = orderIdFilter ? (orders || []).filter(o => orderIdFilter.has(o.order_id)) : (orders || []);

  // Build grouped data
  const grouped: Record<string, Record<string, number>> = {};

  for (const order of filteredOrders) {
    let xKey: string;
    switch (params.x_axis) {
      case 'date': {
        const d = new Date(order.order_date);
        switch (params.granularity) {
          case 'week': {
            const sw = new Date(d);
            sw.setDate(d.getDate() - ((d.getDay() + 6) % 7));
            xKey = sw.toISOString().split('T')[0];
            break;
          }
          case 'month': xKey = order.order_date.substring(0, 7); break;
          case 'quarter': xKey = `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`; break;
          default: xKey = order.order_date.substring(0, 10);
        }
        break;
      }
      case 'source_shop': xKey = order.source_shop; break;
      case 'source_platform': xKey = order.source_platform; break;
      case 'supplier': xKey = order.supplier || 'Brak'; break;
      default: xKey = 'unknown';
    }

    const gKey = params.group_by
      ? (order as Record<string, unknown>)[params.group_by] as string || 'unknown'
      : 'total';

    if (!grouped[xKey]) grouped[xKey] = {};

    let value = 0;
    switch (params.y_axis) {
      case 'revenue_gross': value = order.total_gross_pln || 0; break;
      case 'orders_count': value = 1; break;
      default: value = order.total_gross_pln || 0;
    }

    grouped[xKey][gKey] = (grouped[xKey][gKey] || 0) + value;
  }

  const groups = new Set<string>();
  for (const vals of Object.values(grouped)) {
    for (const g of Object.keys(vals)) groups.add(g);
  }

  const chartData = Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => ({
      x: key,
      ...Object.fromEntries([...groups].map(g => [g, Math.round(values[g] || 0)])),
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
      case 'in': if (Array.isArray(f.value) && f.value.length) query = query.in(f.field, f.value); break;
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
  const itemFields = new Set(['product_name', 'product_category', 'fabric_collection', 'fabric', 'bed_size', 'headboard_height', 'storage_type', 'quantity']);
  const itemFilters = filters.filter(f => itemFields.has(f.field));
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
    case 'in': return Array.isArray(fv) && fv.map(v => String(v)).includes(value);
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
