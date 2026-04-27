import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { parseErpCsv, type RawCsvRow } from '@/lib/erp-parser';
import { listCsvFiles, downloadFileAsText } from '@/lib/google-drive';
import { getSupabaseAdmin } from '@/lib/supabase';

export const maxDuration = 300; // 5 min for large CSV processing
const PAGE_SIZE = 1000;

/**
 * Google Drive auto-import endpoint.
 * Triggered by Vercel Cron daily at 6:00 UTC.
 *
 * Flow:
 * 1. Authenticate with Google Drive via service account
 * 2. Find newest CSV in configured folder
 * 3. Download + parse + insert into Supabase
 * 4. Rebuild aggregations
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'manual';

    // Auth check — Vercel Cron sends this header, or manual trigger via secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.ETL_CRON_SECRET;

    // Vercel Cron sets CRON_SECRET automatically for cron invocations
    const isVercelCron = request.headers.get('x-vercel-cron') === '1';

    if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getSupabaseAdmin();

    // For poll mode (every 10 min): run only when there is a queued manual request.
    let queuedRequestId: number | null = null;
    if (mode === 'poll') {
      const { data: queued } = await db
        .from('etl_log')
        .select('id')
        .eq('source', 'gdrive_csv_manual')
        .eq('status', 'queued')
        .order('started_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!queued) {
        return NextResponse.json({ skipped: true, reason: 'No queued manual request' });
      }

      queuedRequestId = queued.id as number;
      await db.from('etl_log')
        .update({ status: 'running' })
        .eq('id', queuedRequestId);
    }

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
      return NextResponse.json({ error: 'GOOGLE_DRIVE_FOLDER_ID not configured' }, { status: 500 });
    }

    // Create ETL log
    const { data: etlLog } = await db
      .from('etl_log')
      .insert({
        source: 'gdrive_csv',
        started_at: new Date().toISOString(),
        status: 'running',
      })
      .select('id')
      .single();
    const etlLogId = etlLog?.id;

    try {
      // Step 1: Find newest CSV
      const files = await listCsvFiles(folderId);
      if (files.length === 0) {
        await updateLog(etlLogId, 'error', 'No CSV files found in Google Drive folder');
        return NextResponse.json({ error: 'No CSV files found' }, { status: 404 });
      }

      const latestFile = files[0];
      if (etlLogId) {
        await db.from('etl_log').update({ csv_filename: latestFile.name }).eq('id', etlLogId);
      }

      // Step 2: Download
      const csvText = await downloadFileAsText(latestFile.id);

      // Step 3: Parse
      const parseResult = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
      }) as Papa.ParseResult<RawCsvRow>;

      const result = await parseErpCsv(parseResult.data);
      const { orders, items, stats } = result;
      const { min: minDate, max: maxDate } = stats.dateRange;

      // Step 4: Delete old data in range
      if (minDate && maxDate && minDate !== '9999-12-31') {
        const existing = await fetchAllFrom(
          'fact_orders',
          'order_id',
          q => q.gte('order_date', minDate).lte('order_date', maxDate + 'T23:59:59')
        );

        if (existing.length > 0) {
          const ids = existing.map(o => o.order_id as string);
          for (let i = 0; i < ids.length; i += 500) {
            await db.from('fact_order_items').delete().in('order_id', ids.slice(i, i + 500));
          }
          for (let i = 0; i < ids.length; i += 500) {
            await db.from('fact_orders').delete().in('order_id', ids.slice(i, i + 500));
          }
        }
      }

      // Step 5: Insert orders
      let ordersInserted = 0;
      for (let i = 0; i < orders.length; i += 200) {
        const batch = orders.slice(i, i + 200);
        const { error } = await db.from('fact_orders').upsert(batch, { onConflict: 'order_id' });
        if (!error) ordersInserted += batch.length;
      }

      // Step 6: Insert items
      let itemsInserted = 0;
      for (let i = 0; i < items.length; i += 500) {
        const batch = items.slice(i, i + 500);
        const { error } = await db.from('fact_order_items').insert(batch);
        if (!error) itemsInserted += batch.length;
      }

      // Step 7: Rebuild aggregations
      await rebuildDailyRevenue(minDate, maxDate);
      await rebuildDimTables();

      // Step 8: Log success
      await updateLog(etlLogId, 'success', null, {
        rows_processed: stats.totalRows,
        rows_inserted: ordersInserted + itemsInserted,
        date_range_start: minDate !== '9999-12-31' ? minDate : null,
        date_range_end: maxDate !== '0000-01-01' ? maxDate : null,
      });

      if (queuedRequestId) {
        await db.from('etl_log').update({
          status: 'success',
          finished_at: new Date().toISOString(),
          rows_processed: stats.totalRows,
          rows_inserted: ordersInserted + itemsInserted,
          csv_filename: latestFile.name,
          date_range_start: minDate !== '9999-12-31' ? minDate : null,
          date_range_end: maxDate !== '0000-01-01' ? maxDate : null,
        }).eq('id', queuedRequestId);
      }

      return NextResponse.json({
        success: true,
        file: latestFile.name,
        orders: ordersInserted,
        items: itemsInserted,
        dateRange: stats.dateRange,
      });
    } catch (err) {
      if (queuedRequestId) {
        await db.from('etl_log').update({
          status: 'error',
          finished_at: new Date().toISOString(),
          error_message: String(err),
        }).eq('id', queuedRequestId);
      }
      await updateLog(etlLogId, 'error', String(err));
      throw err;
    }
  } catch (err) {
    console.error('GDrive sync error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function updateLog(
  id: number | undefined,
  status: string,
  error_message: string | null,
  extra?: Record<string, unknown>
) {
  if (!id) return;
  await getSupabaseAdmin().from('etl_log').update({
    status,
    error_message,
    finished_at: new Date().toISOString(),
    ...extra,
  }).eq('id', id);
}

async function rebuildDailyRevenue(minDate: string, maxDate: string) {
  if (!minDate || minDate === '9999-12-31') return;

  await getSupabaseAdmin().from('fact_daily_revenue').delete().gte('date', minDate).lte('date', maxDate);

  const orders = await fetchAllFrom(
    'fact_orders',
    'order_date, source_shop, total_gross, total_gross_pln, shipping_cost_pln, is_paid, status, currency',
    q => q.gte('order_date', minDate).lte('order_date', maxDate + 'T23:59:59')
  );

  if (!orders.length) return;

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
      date, source_shop, ...g,
      avg_order_value_pln: g.orders_count > 0 ? g.revenue_gross_pln / g.orders_count : 0,
    };
  });

  for (let i = 0; i < rows.length; i += 500) {
    await getSupabaseAdmin().from('fact_daily_revenue').upsert(rows.slice(i, i + 500), { onConflict: 'date,source_shop' });
  }
}

async function rebuildDimTables() {
  // Products
  const items = await fetchAllFrom('fact_order_items', 'product_name, product_category, quantity, order_id');

  if (items.length) {
    const map: Record<string, { category: string; orders: Set<string>; qty: number }> = {};
    for (const i of items) {
      if (!map[i.product_name]) map[i.product_name] = { category: i.product_category, orders: new Set(), qty: 0 };
      map[i.product_name].orders.add(i.order_id);
      map[i.product_name].qty += i.quantity || 1;
    }
    const rows = Object.entries(map).map(([name, v]) => ({
      product_name: name, product_category: v.category,
      total_orders: v.orders.size, total_quantity: v.qty,
      updated_at: new Date().toISOString(),
    }));
    for (let j = 0; j < rows.length; j += 500) {
      await getSupabaseAdmin().from('dim_products').upsert(rows.slice(j, j + 500), { onConflict: 'product_name' });
    }
  }

  // Fabrics
  const fabItems = await fetchAllFrom(
    'fact_order_items',
    'fabric, fabric_collection, order_id',
    q => q.not('fabric', 'is', null)
  );

  if (fabItems.length) {
    const map: Record<string, { collection: string; orders: Set<string> }> = {};
    for (const i of fabItems) {
      if (!i.fabric) continue;
      if (!map[i.fabric]) map[i.fabric] = { collection: i.fabric_collection || i.fabric, orders: new Set() };
      map[i.fabric].orders.add(i.order_id);
    }
    const rows = Object.entries(map).map(([name, v]) => ({
      fabric_name: name, fabric_collection: v.collection,
      total_orders: v.orders.size, updated_at: new Date().toISOString(),
    }));
    for (let j = 0; j < rows.length; j += 500) {
      await getSupabaseAdmin().from('dim_fabrics').upsert(rows.slice(j, j + 500), { onConflict: 'fabric_name' });
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllFrom(table: string, select: string, apply?: (q: any) => any): Promise<any[]> {
  const out: unknown[] = [];
  let offset = 0;
  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = getSupabaseAdmin().from(table).select(select).range(offset, offset + PAGE_SIZE - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return out as any[];
}
