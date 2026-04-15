import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { parseErpCsv, type RawCsvRow } from '@/lib/erp-parser';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (!file.name.endsWith('.csv')) {
      return NextResponse.json({ error: 'File must be CSV' }, { status: 400 });
    }

    // Log ETL start
    const { data: etlLog } = await supabaseAdmin
      .from('etl_log')
      .insert({
        source: 'erp_csv',
        started_at: new Date().toISOString(),
        status: 'running',
        csv_filename: file.name,
      })
      .select('id')
      .single();

    const etlLogId = etlLog?.id;

    // Read file content
    const text = await file.text();

    // Parse CSV with PapaParse
    const parseResult = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
    }) as Papa.ParseResult<RawCsvRow>;

    if (parseResult.errors.length > 10) {
      const errorMsg = `Too many CSV parse errors: ${parseResult.errors.length}`;
      if (etlLogId) {
        await supabaseAdmin.from('etl_log').update({
          status: 'error',
          error_message: errorMsg,
          finished_at: new Date().toISOString(),
        }).eq('id', etlLogId);
      }
      return NextResponse.json({ error: errorMsg, details: parseResult.errors.slice(0, 5) }, { status: 400 });
    }

    // Parse ERP data
    const result = await parseErpCsv(parseResult.data);

    // Insert into Supabase in batches
    const BATCH_SIZE = 500;
    let ordersInserted = 0;
    let itemsInserted = 0;

    // First: delete orders in the date range (60-day window for WARM data)
    const minDate = result.stats.dateRange.min;
    const maxDate = result.stats.dateRange.max;

    if (minDate && maxDate && minDate !== '9999-12-31') {
      // Delete existing items for orders in range
      const { data: existingOrders } = await supabaseAdmin
        .from('fact_orders')
        .select('order_id')
        .gte('order_date', minDate)
        .lte('order_date', maxDate + 'T23:59:59');

      if (existingOrders && existingOrders.length > 0) {
        const existingIds = existingOrders.map(o => o.order_id);
        // Delete items first (FK constraint)
        for (let i = 0; i < existingIds.length; i += BATCH_SIZE) {
          const batch = existingIds.slice(i, i + BATCH_SIZE);
          await supabaseAdmin.from('fact_order_items').delete().in('order_id', batch);
        }
        // Delete orders
        for (let i = 0; i < existingIds.length; i += BATCH_SIZE) {
          const batch = existingIds.slice(i, i + BATCH_SIZE);
          await supabaseAdmin.from('fact_orders').delete().in('order_id', batch);
        }
      }
    }

    // Insert orders in batches
    for (let i = 0; i < result.orders.length; i += BATCH_SIZE) {
      const batch = result.orders.slice(i, i + BATCH_SIZE);
      const { error } = await supabaseAdmin.from('fact_orders').upsert(batch, {
        onConflict: 'order_id',
      });
      if (error) {
        console.error('Orders insert error:', error);
      } else {
        ordersInserted += batch.length;
      }
    }

    // Insert items in batches
    for (let i = 0; i < result.items.length; i += BATCH_SIZE) {
      const batch = result.items.slice(i, i + BATCH_SIZE);
      const { error } = await supabaseAdmin.from('fact_order_items').insert(batch);
      if (error) {
        console.error('Items insert error:', error);
      } else {
        itemsInserted += batch.length;
      }
    }

    // Rebuild daily revenue aggregation
    await rebuildDailyRevenue(minDate, maxDate);

    // Rebuild dimension tables
    await rebuildDimProducts();
    await rebuildDimFabrics();

    // Update ETL log
    if (etlLogId) {
      await supabaseAdmin.from('etl_log').update({
        status: 'success',
        finished_at: new Date().toISOString(),
        rows_processed: result.stats.totalRows,
        rows_inserted: ordersInserted + itemsInserted,
        date_range_start: minDate !== '9999-12-31' ? minDate : null,
        date_range_end: maxDate !== '0000-01-01' ? maxDate : null,
      }).eq('id', etlLogId);
    }

    return NextResponse.json({
      success: true,
      stats: {
        ...result.stats,
        ordersInserted,
        itemsInserted,
      },
    });
  } catch (err) {
    console.error('ETL upload error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: String(err) },
      { status: 500 }
    );
  }
}

async function rebuildDailyRevenue(minDate: string, maxDate: string) {
  if (!minDate || minDate === '9999-12-31') return;

  // Delete existing daily revenue in range
  await supabaseAdmin
    .from('fact_daily_revenue')
    .delete()
    .gte('date', minDate)
    .lte('date', maxDate);

  // Aggregate from fact_orders
  const { data: orders } = await supabaseAdmin
    .from('fact_orders')
    .select('order_date, source_shop, total_gross, total_gross_pln, shipping_cost_pln, is_paid, status, currency')
    .gte('order_date', minDate)
    .lte('order_date', maxDate + 'T23:59:59');

  if (!orders || orders.length === 0) return;

  // Group by date + shop
  const grouped: Record<string, {
    orders_count: number;
    orders_paid: number;
    orders_cancelled: number;
    revenue_gross_pln: number;
    revenue_paid_pln: number;
    shipping_revenue_pln: number;
    revenue_gross_original: number;
    original_currency: string;
  }> = {};

  for (const o of orders) {
    const date = o.order_date.substring(0, 10);
    const key = `${date}|${o.source_shop}`;

    if (!grouped[key]) {
      grouped[key] = {
        orders_count: 0,
        orders_paid: 0,
        orders_cancelled: 0,
        revenue_gross_pln: 0,
        revenue_paid_pln: 0,
        shipping_revenue_pln: 0,
        revenue_gross_original: 0,
        original_currency: o.currency || 'PLN',
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
      date,
      source_shop,
      orders_count: g.orders_count,
      orders_paid: g.orders_paid,
      orders_cancelled: g.orders_cancelled,
      revenue_gross_pln: g.revenue_gross_pln,
      revenue_paid_pln: g.revenue_paid_pln,
      shipping_revenue_pln: g.shipping_revenue_pln,
      avg_order_value_pln: g.orders_count > 0 ? g.revenue_gross_pln / g.orders_count : 0,
      revenue_gross_original: g.revenue_gross_original,
      original_currency: g.original_currency,
    };
  });

  // Insert in batches
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    await supabaseAdmin.from('fact_daily_revenue').upsert(batch, {
      onConflict: 'date,source_shop',
    });
  }
}

async function rebuildDimProducts() {
  // Manual aggregation from fact_order_items
  const { data: items } = await supabaseAdmin
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
    product_name: name,
    product_category: v.category,
    total_orders: v.orders.size,
    total_quantity: v.quantity,
    updated_at: new Date().toISOString(),
  }));

  for (let i = 0; i < rows.length; i += 500) {
    await supabaseAdmin.from('dim_products').upsert(rows.slice(i, i + 500), {
      onConflict: 'product_name',
    });
  }
}

async function rebuildDimFabrics() {
  const { data: items } = await supabaseAdmin
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
    fabric_name: name,
    fabric_collection: v.collection,
    total_orders: v.orders.size,
    updated_at: new Date().toISOString(),
  }));

  for (let i = 0; i < rows.length; i += 500) {
    await supabaseAdmin.from('dim_fabrics').upsert(rows.slice(i, i + 500), {
      onConflict: 'fabric_name',
    });
  }
}
