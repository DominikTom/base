import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  ETL_PIPELINE,
  ETL_VERSION,
  insertQuarantine,
  insertRawRows,
  runSanityChecks,
  upsertItemsRpc,
  upsertOrdersRpc,
} from '@/lib/erp-etl';
import type { FactOrder, FactOrderItem } from '@/types/database';
import type { QuarantineEntry, RawCsvRow } from '@/lib/erp-parser';

export const maxDuration = 60;

/**
 * Batch-action API for browser-driven CSV import.
 *
 * Actions:
 *   start             — create etl_log + return etlRunId (UUID)
 *   batch_raw         — append RawCsvRow[] to raw_erp_orders
 *   batch_orders      — RPC upsert FactOrder[] (idempotent via row_hash)
 *   batch_items       — RPC upsert FactOrderItem[] (UNIQUE(order_id,line_number))
 *   batch_daily_revenue — UPSERT pre-aggregated daily revenue rows
 *   batch_quarantine  — insert QuarantineEntry[] into etl_quarantine
 *   finalize          — run sanity checks, set status, finish etl_log
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }
    const action = (body as { action?: string })?.action;

    switch (action) {
      case 'start':
        return await handleStart(body as StartBody);
      case 'batch_raw':
        return await handleBatchRaw(body as BatchRawBody);
      case 'batch_orders':
        return await handleBatchOrders(body as BatchOrdersBody);
      case 'batch_items':
        return await handleBatchItems(body as BatchItemsBody);
      case 'batch_daily_revenue':
        return await handleBatchDailyRevenue(body as BatchRevenueBody);
      case 'batch_quarantine':
        return await handleBatchQuarantine(body as BatchQuarantineBody);
      case 'finalize':
        return await handleFinalize(body as FinalizeBody);
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

// ── Types ────────────────────────────────────────────────────────────────────

interface StartBody {
  filename?: string;
  dateRange?: { min: string; max: string };
  etlRunId?: string;
}
interface BatchRawBody {
  etlLogId: number;
  etlRunId: string;
  filename: string;
  startRowNumber: number;
  rows: RawCsvRow[];
}
interface BatchOrdersBody {
  etlLogId: number;
  orders: FactOrder[];
}
interface BatchItemsBody {
  etlLogId: number;
  items: FactOrderItem[];
}
interface BatchRevenueBody {
  etlLogId: number;
  rows: Record<string, unknown>[];
}
interface BatchQuarantineBody {
  etlLogId: number;
  etlRunId: string;
  filename: string;
  entries: QuarantineEntry[];
}
interface FinalizeBody {
  etlLogId: number;
  etlRunId: string;
  stats: {
    totalRows: number;
    ordersCount: number;
    itemsCount: number;
    quarantinedRows?: number;
  };
  warnings?: string[];
  dateRange: { min: string; max: string };
}

// ── START ────────────────────────────────────────────────────────────────────

async function handleStart(body: StartBody) {
  const { filename, dateRange, etlRunId } = body;
  const runId = etlRunId || crypto.randomUUID();

  const { data: etlLog, error: logError } = await getSupabaseAdmin()
    .from('etl_log')
    .insert({
      source: 'erp_csv',
      pipeline: ETL_PIPELINE,
      version: ETL_VERSION,
      started_at: new Date().toISOString(),
      status: 'running',
      csv_filename: filename || 'upload',
      date_range_start: dateRange?.min !== '9999-12-31' ? dateRange?.min : null,
      date_range_end: dateRange?.max !== '0000-01-01' ? dateRange?.max : null,
      details: { etl_run_id: runId },
    })
    .select('id')
    .single();

  if (logError) {
    return NextResponse.json({ error: logError.message }, { status: 500 });
  }

  // Wipe daily revenue for the imported range so the upcoming batch_daily_revenue
  // upserts always replace stale aggregates.
  if (dateRange?.min && dateRange?.max && dateRange.min !== '9999-12-31') {
    await getSupabaseAdmin()
      .from('fact_daily_revenue')
      .delete()
      .gte('date', dateRange.min)
      .lte('date', dateRange.max);
  }

  return NextResponse.json({ etlLogId: etlLog.id, etlRunId: runId });
}

// ── BATCH RAW ────────────────────────────────────────────────────────────────

async function handleBatchRaw(body: BatchRawBody) {
  const { rows, etlRunId, filename, startRowNumber } = body;
  if (!rows?.length) return NextResponse.json({ inserted: 0 });

  const inserted = await insertRawRows(getSupabaseAdmin(), rows, {
    etlRunId,
    sourceFile: filename,
    startRowNumber,
  });
  return NextResponse.json({ inserted });
}

// ── BATCH ORDERS ─────────────────────────────────────────────────────────────

async function handleBatchOrders(body: BatchOrdersBody) {
  const { orders } = body;
  if (!orders?.length) return NextResponse.json({ inserted: 0 });

  try {
    const upserted = await upsertOrdersRpc(getSupabaseAdmin(), orders);
    return NextResponse.json({ inserted: upserted });
  } catch (err) {
    console.error('Batch orders error:', err);
    return NextResponse.json({ error: String(err), inserted: 0 }, { status: 500 });
  }
}

// ── BATCH ITEMS ──────────────────────────────────────────────────────────────

async function handleBatchItems(body: BatchItemsBody) {
  const { items } = body;
  if (!items?.length) return NextResponse.json({ inserted: 0 });

  try {
    const upserted = await upsertItemsRpc(getSupabaseAdmin(), items);
    return NextResponse.json({ inserted: upserted });
  } catch (err) {
    console.error('Batch items error:', err);
    return NextResponse.json({ error: String(err), inserted: 0 }, { status: 500 });
  }
}

// ── BATCH DAILY REVENUE ──────────────────────────────────────────────────────

async function handleBatchDailyRevenue(body: BatchRevenueBody) {
  const { rows } = body;
  if (!rows?.length) return NextResponse.json({ inserted: 0 });

  const { error } = await getSupabaseAdmin().from('fact_daily_revenue').upsert(rows, {
    onConflict: 'date,source_shop',
  });

  if (error) {
    console.error('Batch daily revenue error:', error);
    return NextResponse.json({ error: error.message, inserted: 0 }, { status: 500 });
  }
  return NextResponse.json({ inserted: rows.length });
}

// ── BATCH QUARANTINE ─────────────────────────────────────────────────────────

async function handleBatchQuarantine(body: BatchQuarantineBody) {
  const { entries, etlRunId, filename } = body;
  if (!entries?.length) return NextResponse.json({ inserted: 0 });

  try {
    const inserted = await insertQuarantine(getSupabaseAdmin(), entries, {
      etlRunId,
      sourceFile: filename,
    });
    return NextResponse.json({ inserted });
  } catch (err) {
    console.error('Batch quarantine error:', err);
    return NextResponse.json({ error: String(err), inserted: 0 }, { status: 500 });
  }
}

// ── FINALIZE ─────────────────────────────────────────────────────────────────

async function handleFinalize(body: FinalizeBody) {
  const { etlLogId, etlRunId, stats, warnings, dateRange } = body;
  if (!etlLogId) {
    return NextResponse.json({ error: 'etlLogId required' }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const sanity = await runSanityChecks(db, {
    from: dateRange?.min !== '9999-12-31' ? dateRange?.min : undefined,
    to: dateRange?.max !== '0000-01-01' ? dateRange?.max : undefined,
  });

  const totalRows = stats?.totalRows || 0;
  const quarantined = stats?.quarantinedRows || 0;
  const partialThreshold = 0.01;
  const status = totalRows > 0 && quarantined / totalRows > partialThreshold ? 'partial' : 'success';

  await db.from('etl_log').update({
    status,
    finished_at: new Date().toISOString(),
    rows_processed: totalRows,
    rows_inserted: (stats?.ordersCount || 0) + (stats?.itemsCount || 0),
    rows_quarantined: quarantined,
    date_range_start: dateRange?.min !== '9999-12-31' ? dateRange?.min : null,
    date_range_end: dateRange?.max !== '0000-01-01' ? dateRange?.max : null,
    details: {
      etl_run_id: etlRunId,
      warnings: warnings || [],
      sanity,
    },
  }).eq('id', etlLogId);

  return NextResponse.json({ success: true, status, sanity });
}
