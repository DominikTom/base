import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import type { FactOrder, FactOrderItem } from '@/types/database';

export const maxDuration = 60;

/**
 * Batch-action API for CSV import.
 * Client parses CSV in browser, then sends data in small JSON batches.
 *
 * Actions:
 *   start        — create etl_log, delete old data in date range
 *   batch_orders — upsert a batch of orders (~200)
 *   batch_items  — insert a batch of order items (~500)
 *   finalize     — rebuild aggregations, update etl_log
 */
export async function POST(request: NextRequest) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }

    const { action } = body;

    switch (action) {
      case 'start':
        return await handleStart(body);
      case 'batch_orders':
        return await handleBatchOrders(body);
      case 'batch_items':
        return await handleBatchItems(body);
      case 'finalize':
        return await handleFinalize(body);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('ETL upload error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: String(err) },
      { status: 500 }
    );
  }
}

// ── START ────────────────────────────────────────────────────────────────────

async function handleStart(body: { filename?: string; dateRange?: { min: string; max: string } }) {
  const { filename, dateRange } = body;

  // Create ETL log entry
  const { data: etlLog, error: logError } = await getSupabaseAdmin()
    .from('etl_log')
    .insert({
      source: 'erp_csv',
      started_at: new Date().toISOString(),
      status: 'running',
      csv_filename: filename || 'upload',
      date_range_start: dateRange?.min,
      date_range_end: dateRange?.max,
    })
    .select('id')
    .single();

  if (logError) {
    return NextResponse.json({ error: logError.message }, { status: 500 });
  }

  // Delete existing data in date range
  let deletedOrders = 0;
  if (dateRange?.min && dateRange?.max && dateRange.min !== '9999-12-31') {
    const { data: existingOrders } = await getSupabaseAdmin()
      .from('fact_orders')
      .select('order_id')
      .gte('order_date', dateRange.min)
      .lte('order_date', dateRange.max + 'T23:59:59');

    if (existingOrders && existingOrders.length > 0) {
      const ids = existingOrders.map(o => o.order_id);
      const BATCH = 500;
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        await getSupabaseAdmin().from('fact_order_items').delete().in('order_id', batch);
      }
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        await getSupabaseAdmin().from('fact_orders').delete().in('order_id', batch);
      }
      deletedOrders = ids.length;
    }
  }

  return NextResponse.json({
    etlLogId: etlLog.id,
    deletedOrders,
  });
}

// ── BATCH ORDERS ─────────────────────────────────────────────────────────────

async function handleBatchOrders(body: { etlLogId: number; orders: FactOrder[] }) {
  const { orders } = body;

  if (!orders?.length) {
    return NextResponse.json({ inserted: 0 });
  }

  const { error } = await getSupabaseAdmin().from('fact_orders').upsert(orders, {
    onConflict: 'order_id',
  });

  if (error) {
    console.error('Batch orders error:', error);
    return NextResponse.json({ error: error.message, inserted: 0 }, { status: 500 });
  }

  return NextResponse.json({ inserted: orders.length });
}

// ── BATCH ITEMS ──────────────────────────────────────────────────────────────

async function handleBatchItems(body: { etlLogId: number; items: FactOrderItem[] }) {
  const { items } = body;

  if (!items?.length) {
    return NextResponse.json({ inserted: 0 });
  }

  const { error } = await getSupabaseAdmin().from('fact_order_items').insert(items);

  if (error) {
    console.error('Batch items error:', error);
    return NextResponse.json({ error: error.message, inserted: 0 }, { status: 500 });
  }

  return NextResponse.json({ inserted: items.length });
}

// ── FINALIZE ─────────────────────────────────────────────────────────────────

async function handleFinalize(body: {
  etlLogId: number;
  stats: { totalRows: number; ordersCount: number; itemsCount: number };
  dateRange: { min: string; max: string };
}) {
  const { etlLogId, stats, dateRange } = body;

  // Rebuild daily revenue
  if (dateRange?.min && dateRange?.max && dateRange.min !== '9999-12-31') {
    await rebuildDailyRevenue(dateRange.min, dateRange.max);
  }

  // Rebuild dimension tables
  await rebuildDimProducts();
  await rebuildDimFabrics();

  // Update ETL log
  if (etlLogId) {
    await getSupabaseAdmin().from('etl_log').update({
      status: 'success',
      finished_at: new Date().toISOString(),
      rows_processed: stats?.totalRows || 0,
      rows_inserted: (stats?.ordersCount || 0) + (stats?.itemsCount || 0),
      date_range_start: dateRange?.min !== '9999-12-31' ? dateRange?.min : null,
      date_range_end: dateRange?.max !== '0000-01-01' ? dateRange?.max : null,
    }).eq('id', etlLogId);
  }

  return NextResponse.json({ success: true });
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

async function rebuildDailyRevenue(minDate: string, maxDate: string) {
  if (!minDate || minDate === '9999-12-31') return;

  await getSupabaseAdmin()
    .from('fact_daily_revenue')
    .delete()
    .gte('date', minDate)
    .lte('date', maxDate);

  const { data: orders } = await getSupabaseAdmin()
    .from('fact_orders')
    .select('order_date, source_shop, total_gross, total_gross_pln, shipping_cost_pln, is_paid, status, currency')
    .gte('order_date', minDate)
    .lte('order_date', maxDate + 'T23:59:59');

  if (!orders || orders.length === 0) return;

  const grouped: Record<string, {
    orders_count: number; orders_paid: number; orders_cancelled: number;
    revenue_gross_pln: number; revenue_paid_pln: number; shipping_revenue_pln: number;
    revenue_gross_original: number; original_currency: string;
  }> = {};

  for (const o of orders) {
    const date = o.order_date.substring(0, 10);
    const key = `${date}|${o.source_shop}`;
    if (!grouped[key]) {
      grouped[key] = {
        orders_count: 0, orders_paid: 0, orders_cancelled: 0,
        revenue_gross_pln: 0, revenue_paid_pln: 0, shipping_revenue_pln: 0,
        revenue_gross_original: 0, original_currency: o.currency || 'PLN',
      };
    }
    const g = grouped[key];
    g.orders_count++;
    if (o.is_paid) g.orders_paid++;
    if (o.status === 'anulowane') g.orders_cancelled++;
    g.revenue_gross_pln += o.total_gross_pln || 0;
    if (o.is_paid) g.revenue_paid_pln += o.total_gross_pln || 0;
    g.shipping_revenue_pln += o.shipping_cost_pln || 0;
    g.revenue_gross_original += o.total_gross || 0;
  }

  const rows = Object.entries(grouped).map(([key, g]) => {
    const [date, source_shop] = key.split('|');
    return {
      date, source_shop,
      orders_count: g.orders_count, orders_paid: g.orders_paid, orders_cancelled: g.orders_cancelled,
      revenue_gross_pln: g.revenue_gross_pln, revenue_paid_pln: g.revenue_paid_pln,
      shipping_revenue_pln: g.shipping_revenue_pln,
      avg_order_value_pln: g.orders_count > 0 ? g.revenue_gross_pln / g.orders_count : 0,
      revenue_gross_original: g.revenue_gross_original, original_currency: g.original_currency,
    };
  });

  for (let i = 0; i < rows.length; i += 500) {
    await getSupabaseAdmin().from('fact_daily_revenue').upsert(rows.slice(i, i + 500), {
      onConflict: 'date,source_shop',
    });
  }
}

async function rebuildDimProducts() {
  const { data: items } = await getSupabaseAdmin()
    .from('fact_order_items')
    .select('product_name, product_category, quantity, order_id');

  if (!items || items.length === 0) return;

  const map: Record<string, { category: string; orders: Set<string>; quantity: number }> = {};
  for (const item of items) {
    if (!map[item.product_name]) {
      map[item.product_name] = { category: item.product_category, orders: new Set(), quantity: 0 };
    }
    map[item.product_name].orders.add(item.order_id);
    map[item.product_name].quantity += item.quantity || 1;
  }

  const rows = Object.entries(map).map(([name, v]) => ({
    product_name: name, product_category: v.category,
    total_orders: v.orders.size, total_quantity: v.quantity,
    updated_at: new Date().toISOString(),
  }));

  for (let i = 0; i < rows.length; i += 500) {
    await getSupabaseAdmin().from('dim_products').upsert(rows.slice(i, i + 500), { onConflict: 'product_name' });
  }
}

async function rebuildDimFabrics() {
  const { data: items } = await getSupabaseAdmin()
    .from('fact_order_items')
    .select('fabric, fabric_collection, order_id')
    .not('fabric', 'is', null);

  if (!items || items.length === 0) return;

  const map: Record<string, { collection: string; orders: Set<string> }> = {};
  for (const item of items) {
    if (!item.fabric) continue;
    if (!map[item.fabric]) {
      map[item.fabric] = { collection: item.fabric_collection || item.fabric, orders: new Set() };
    }
    map[item.fabric].orders.add(item.order_id);
  }

  const rows = Object.entries(map).map(([name, v]) => ({
    fabric_name: name, fabric_collection: v.collection,
    total_orders: v.orders.size, updated_at: new Date().toISOString(),
  }));

  for (let i = 0; i < rows.length; i += 500) {
    await getSupabaseAdmin().from('dim_fabrics').upsert(rows.slice(i, i + 500), { onConflict: 'fabric_name' });
  }
}
