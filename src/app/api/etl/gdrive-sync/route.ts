import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { parseErpCsv, type RawCsvRow } from '@/lib/erp-parser';
import { listCsvFiles, downloadFileAsText } from '@/lib/google-drive';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
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
const RAW_CHUNK = 1000;
const ORDERS_CHUNK = 500;
const ITEMS_CHUNK = 1000;

/**
 * Stop issuing new work after this much wall-clock time and finalize the log.
 *
 * The platform kills the function at maxDuration with no chance to run
 * `finally`, which is how every run since 2026-04-28 ended: the ETL row stayed
 * `running` until the next invocation auto-closed it 45 min later as stale,
 * and the advisory lock was never released. Finishing under our own budget
 * means the log always tells the truth about what happened.
 */
const TIME_BUDGET_MS = 240_000;

/**
 * Appending the full export to raw_erp_orders on every run grew the landing
 * table to 30.6M rows for 49k orders and dominated the runtime (~440 inserts
 * per run before a single fact row was written). It is an audit trail, not a
 * dependency of any dashboard query, so it is opt-in now and retained for a
 * few runs only. Set ETL_RAW_LANDING=1 to re-enable.
 */
const RAW_LANDING_ENABLED = process.env.ETL_RAW_LANDING === '1';
const RAW_LANDING_KEEP_RUNS = Number(process.env.ETL_RAW_LANDING_KEEP_RUNS || 3);

/**
 * Google Drive auto-import endpoint.
 * Triggered by Vercel Cron daily (mode=daily) and every 10 min (mode=poll).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'manual';

    // Auth via the shared guard: bearer CRON_SECRET / ETL_CRON_SECRET, or an
    // admin session. The `x-vercel-cron` header and the `vercel-cron`
    // user-agent are gone — both are ordinary request headers that Vercel sets
    // on its own calls but does not strip from inbound traffic, so either one
    // let anyone on the internet drive a full ETL run.
    const guard = await requireAdmin();
    if (guard) return guard;

    const startedAtMs = Date.now();
    const timeLeft = () => TIME_BUDGET_MS - (Date.now() - startedAtMs);

    const db = getSupabaseAdmin();
    await closeStaleRunningLogs(db);
    const freshRunning = await hasFreshRunningLog(db);
    if (freshRunning) {
      return NextResponse.json({
        skipped: true,
        reason: 'ETL run already active (<45 min)',
        activeRunId: freshRunning.id,
        activeSource: freshRunning.source,
      });
    }

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

      // Step 3: facts first. The raw landing table is only an audit trail, so
      // it must never consume the budget the dashboards actually depend on.
      //
      // The old step 4 deleted fact_daily_revenue for the whole CSV date range
      // here and relied on step 7 to rebuild it. Step 7 never ran, so the table
      // sat empty. The delete now lives inside fn_rebuild_daily_revenue, in the
      // same statement as the insert that replaces it.
      let ordersUpserted = 0;
      let truncated = false;
      for (let i = 0; i < orders.length; i += ORDERS_CHUNK) {
        if (timeLeft() <= 0) { truncated = true; break; }
        ordersUpserted += await upsertOrdersRpc(db, orders.slice(i, i + ORDERS_CHUNK));
      }

      let itemsUpserted = 0;
      for (let i = 0; i < items.length; i += ITEMS_CHUNK) {
        if (timeLeft() <= 0) { truncated = true; break; }
        itemsUpserted += await upsertItemsRpc(db, items.slice(i, i + ITEMS_CHUNK));
      }

      // Step 4: optional raw landing (audit trail), with retention.
      let rawInserted = 0;
      let rawPurged = 0;
      if (RAW_LANDING_ENABLED) {
        for (let i = 0; i < csvRows.length; i += RAW_CHUNK) {
          if (timeLeft() <= 0) { truncated = true; break; }
          const chunk = csvRows.slice(i, i + RAW_CHUNK);
          rawInserted += await insertRawRows(db, chunk, {
            etlRunId,
            sourceFile: latestFile.name,
            startRowNumber: i + 2, // +1 zero-index, +1 header
          });
        }
        rawPurged = await purgeRawLanding(db, RAW_LANDING_KEEP_RUNS);
      }

      // Step 5: quarantine
      let quarantined = 0;
      if (quarantine.length) {
        quarantined = await insertQuarantine(db, quarantine, {
          etlRunId,
          sourceFile: latestFile.name,
        });
      }

      // Step 6: rebuild aggregations server-side.
      // These used to page every order and every one of the 154k order items
      // over PostgREST and group them in JS — several hundred round-trips that
      // never fit the function budget. Now three statements in the database.
      const aggregates = await rebuildAggregates(db, minDate, maxDate);

      // Step 7: sanity + finish log
      const sanity = await runSanityChecks(db, {
        from: minDate !== '9999-12-31' ? minDate : undefined,
        to: maxDate !== '0000-01-01' ? maxDate : undefined,
      });

      const totalRows = stats.totalRows;
      const tooManyQuarantined = totalRows > 0 && quarantined / totalRows > 0.01;
      const status = truncated || tooManyQuarantined ? 'partial' : 'success';
      const durationMs = Date.now() - startedAtMs;

      await finishLog(db, etlLogId, status, truncated ? 'Stopped at time budget — rerun to continue' : null, {
        rows_processed: totalRows,
        rows_inserted: ordersUpserted + itemsUpserted,
        rows_quarantined: quarantined,
        date_range_start: minDate !== '9999-12-31' ? minDate : null,
        date_range_end: maxDate !== '0000-01-01' ? maxDate : null,
        details: {
          etl_run_id: etlRunId, mode, warnings, sanity,
          raw_rows_inserted: rawInserted,
          raw_rows_purged: rawPurged,
          aggregates,
          duration_ms: durationMs,
          truncated,
        },
      });

      return NextResponse.json({
        success: true,
        status,
        file: latestFile.name,
        orders: ordersUpserted,
        items: itemsUpserted,
        rawRows: rawInserted,
        rawPurged,
        quarantined,
        warnings: warnings.length,
        dateRange: stats.dateRange,
        aggregates,
        durationMs,
        truncated,
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

async function hasFreshRunningLog(db: ReturnType<typeof getSupabaseAdmin>) {
  const staleBefore = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  const { data } = await db
    .from('etl_log')
    .select('id, source')
    .in('source', ['gdrive_csv', 'gdrive_csv_manual', 'erp_csv'])
    .eq('status', 'running')
    .gte('started_at', staleBefore)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as { id: number; source: string } | null;
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

async function rebuildAggregates(
  db: ReturnType<typeof getSupabaseAdmin>,
  minDate: string,
  maxDate: string
): Promise<{ dailyRevenueRows: number; products: number; fabrics: number }> {
  const out = { dailyRevenueRows: 0, products: 0, fabrics: 0 };

  if (minDate && minDate !== '9999-12-31' && maxDate && maxDate !== '0000-01-01') {
    const { data, error } = await db.rpc('fn_rebuild_daily_revenue', {
      p_from: minDate,
      p_to: maxDate,
    });
    if (error) throw new Error(`fn_rebuild_daily_revenue: ${error.message}`);
    out.dailyRevenueRows = typeof data === 'number' ? data : 0;
  }

  const { data: prod, error: prodErr } = await db.rpc('fn_rebuild_dim_products');
  if (prodErr) throw new Error(`fn_rebuild_dim_products: ${prodErr.message}`);
  out.products = typeof prod === 'number' ? prod : 0;

  const { data: fab, error: fabErr } = await db.rpc('fn_rebuild_dim_fabrics');
  if (fabErr) throw new Error(`fn_rebuild_dim_fabrics: ${fabErr.message}`);
  out.fabrics = typeof fab === 'number' ? fab : 0;

  return out;
}

async function purgeRawLanding(
  db: ReturnType<typeof getSupabaseAdmin>,
  keepRuns: number
): Promise<number> {
  const { data, error } = await db.rpc('fn_purge_raw_erp_orders', { p_keep_runs: keepRuns });
  if (error) {
    // Retention is housekeeping — never fail an otherwise good run over it.
    console.error('raw_erp_orders purge failed:', error.message);
    return 0;
  }
  return typeof data === 'number' ? data : 0;
}
