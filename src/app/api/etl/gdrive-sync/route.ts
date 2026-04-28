import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { parseErpCsv, type RawCsvRow } from '@/lib/erp-parser';
import { listCsvFiles, downloadFileAsText } from '@/lib/google-drive';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  ETL_PIPELINE,
  ETL_VERSION,
  insertQuarantine,
  insertRawRows,
  releaseGdriveLock,
  runSanityChecks,
  tryAcquireGdriveLock,
  upsertItemsRpc,
  upsertOrdersRpc,
} from '@/lib/erp-etl';

export const maxDuration = 300;
const PAGE_SIZE = 1000;
const RAW_CHUNK = 500;
const ORDERS_CHUNK = 200;
const ITEMS_CHUNK = 500;

/**
 * Google Drive auto-import endpoint.
 * Triggered by Vercel Cron daily (mode=daily) and every 10 min (mode=poll).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'manual';

    // Auth — Vercel Cron sends x-vercel-cron header; manual triggers use bearer.
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.ETL_CRON_SECRET;
    const isVercelCron = request.headers.get('x-vercel-cron') === '1';

    if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getSupabaseAdmin();
    await closeStaleRunningLogs(db);

    // Poll mode runs only when there's a queued manual request.
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
      await db.from('etl_log').update({ status: 'running' }).eq('id', queuedRequestId);
    }

    // Acquire advisory lock so daily + poll never overlap.
    const locked = await tryAcquireGdriveLock(db);
    if (!locked) {
      if (queuedRequestId) {
        await db.from('etl_log').update({ status: 'queued' }).eq('id', queuedRequestId);
      }
      return NextResponse.json({ skipped: true, reason: 'GDrive sync already running' });
    }

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
      await releaseGdriveLock(db);
      return NextResponse.json({ error: 'GOOGLE_DRIVE_FOLDER_ID not configured' }, { status: 500 });
    }

    const etlRunId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    // Use the queued log row when available; otherwise create a new one.
    let etlLogId: number | undefined;
    if (queuedRequestId) {
      etlLogId = queuedRequestId;
      await db.from('etl_log').update({
        pipeline: ETL_PIPELINE,
        version: ETL_VERSION,
        details: { etl_run_id: etlRunId, mode },
      }).eq('id', queuedRequestId);
    } else {
      const { data: etlLog } = await db
        .from('etl_log')
        .insert({
          source: 'gdrive_csv',
          pipeline: ETL_PIPELINE,
          version: ETL_VERSION,
          started_at: startedAt,
          status: 'running',
          details: { etl_run_id: etlRunId, mode },
        })
        .select('id')
        .single();
      etlLogId = etlLog?.id;
    }

    try {
      // Step 1: pick newest CSV
      const files = await listCsvFiles(folderId);
      if (files.length === 0) {
        await finishLog(db, etlLogId, 'error', 'No CSV files found in Google Drive folder');
        return NextResponse.json({ error: 'No CSV files found' }, { status: 404 });
      }
      const latestFile = files[0];
      if (etlLogId) {
        await db.from('etl_log').update({ csv_filename: latestFile.name }).eq('id', etlLogId);
      }

      // Step 2: download + parse
      const csvText = await downloadFileAsText(latestFile.id);
      const parsed = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
      }) as Papa.ParseResult<RawCsvRow>;

      const csvRows = parsed.data;
      const result = await parseErpCsv(csvRows);
      const { orders, items, quarantine, warnings, stats } = result;
      const { min: minDate, max: maxDate } = stats.dateRange;

      // Step 3: append raw rows (audit trail)
      let rawInserted = 0;
      for (let i = 0; i < csvRows.length; i += RAW_CHUNK) {
        const chunk = csvRows.slice(i, i + RAW_CHUNK);
        rawInserted += await insertRawRows(db, chunk, {
          etlRunId,
          sourceFile: latestFile.name,
          startRowNumber: i + 2, // +1 zero-index, +1 header
        });
      }

      // Step 4: clear daily_revenue for affected date range (will re-aggregate)
      if (minDate && minDate !== '9999-12-31' && maxDate && maxDate !== '0000-01-01') {
        await db.from('fact_daily_revenue').delete().gte('date', minDate).lte('date', maxDate);
      }

      // Step 5: idempotent upserts via RPC (fact_orders.row_hash drives change detection)
      let ordersUpserted = 0;
      for (let i = 0; i < orders.length; i += ORDERS_CHUNK) {
        ordersUpserted += await upsertOrdersRpc(db, orders.slice(i, i + ORDERS_CHUNK));
      }

      let itemsUpserted = 0;
      for (let i = 0; i < items.length; i += ITEMS_CHUNK) {
        itemsUpserted += await upsertItemsRpc(db, items.slice(i, i + ITEMS_CHUNK));
      }

      // Step 6: quarantine
      let quarantined = 0;
      if (quarantine.length) {
        quarantined = await insertQuarantine(db, quarantine, {
          etlRunId,
          sourceFile: latestFile.name,
        });
      }

      // Step 7: rebuild aggregations (daily_revenue + dim_*)
      await rebuildDailyRevenue(minDate, maxDate);
      await rebuildDimTables();

      // Step 8: sanity + finish log
      const sanity = await runSanityChecks(db, {
        from: minDate !== '9999-12-31' ? minDate : undefined,
        to: maxDate !== '0000-01-01' ? maxDate : undefined,
      });

      const totalRows = stats.totalRows;
      const status = totalRows > 0 && quarantined / totalRows > 0.01 ? 'partial' : 'success';

      await finishLog(db, etlLogId, status, null, {
        rows_processed: totalRows,
        rows_inserted: ordersUpserted + itemsUpserted,
        rows_quarantined: quarantined,
        date_range_start: minDate !== '9999-12-31' ? minDate : null,
        date_range_end: maxDate !== '0000-01-01' ? maxDate : null,
        details: { etl_run_id: etlRunId, mode, warnings, sanity, raw_rows_inserted: rawInserted },
      });

      return NextResponse.json({
        success: true,
        status,
        file: latestFile.name,
        orders: ordersUpserted,
        items: itemsUpserted,
        rawRows: rawInserted,
        quarantined,
        warnings: warnings.length,
        dateRange: stats.dateRange,
      });
    } catch (err) {
      await finishLog(db, etlLogId, 'error', String(err));
      throw err;
    } finally {
      await releaseGdriveLock(db);
    }
  } catch (err) {
    console.error('GDrive sync error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function closeStaleRunningLogs(db: ReturnType<typeof getSupabaseAdmin>) {
  // Serverless timeouts/redeploys can leave ETL rows in `running` forever.
  // Auto-close old runs so monitoring/queue state stays truthful.
  const staleBefore = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  await db
    .from('etl_log')
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_message: 'Auto-closed stale running ETL run (>45 min without finalize)',
    })
    .in('source', ['gdrive_csv', 'gdrive_csv_manual', 'erp_csv'])
    .eq('status', 'running')
    .lt('started_at', staleBefore);
}

async function finishLog(
  db: ReturnType<typeof getSupabaseAdmin>,
  id: number | undefined,
  status: string,
  error_message: string | null,
  extra?: Record<string, unknown>
) {
  if (!id) return;
  await db.from('etl_log').update({
    status,
    error_message,
    finished_at: new Date().toISOString(),
    ...extra,
  }).eq('id', id);
}

async function rebuildDailyRevenue(minDate: string, maxDate: string) {
  if (!minDate || minDate === '9999-12-31') return;

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
