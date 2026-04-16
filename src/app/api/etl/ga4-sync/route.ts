import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchGA4Report, fetchGA4DailyTotals, getPropertyIds, getHostname } from '@/lib/ga4';

export const maxDuration = 60;

/**
 * GA4 sync endpoint — fetches traffic data from all GA4 properties.
 * Triggered by Vercel Cron daily at 6:30 UTC, or manually.
 */
// POST — manual trigger from dashboard UI (90 days history)
export async function POST() {
  return syncGA4(90);
}

// GET — Vercel Cron trigger (last 7 days only)
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.ETL_CRON_SECRET;
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return syncGA4(7);
}

async function syncGA4(daysBack: number = 7) {
  try {

    const db = getSupabaseAdmin();
    const propertyIds = getPropertyIds();

    if (propertyIds.length === 0) {
      return NextResponse.json({ error: 'GA4_PROPERTY_IDS not configured' }, { status: 500 });
    }

    // Create ETL log
    const { data: etlLog } = await db
      .from('etl_log')
      .insert({ source: 'ga4', started_at: new Date().toISOString(), status: 'running' })
      .select('id')
      .single();
    const etlLogId = etlLog?.id;

    try {
      // Date range: T-1 to T-daysBack
      const today = new Date();
      const dateTo = new Date(today);
      dateTo.setDate(dateTo.getDate() - 1);
      const dateFrom = new Date(today);
      dateFrom.setDate(dateFrom.getDate() - daysBack);

      const fmt = (d: Date) => d.toISOString().split('T')[0];
      const dateFromStr = fmt(dateFrom);
      const dateToStr = fmt(dateTo);

      let totalRows = 0;
      const results: Record<string, number> = {};

      // Delete only the date range being synced (preserve older data)
      await db.from('fact_daily_traffic').delete()
        .gte('date', dateFromStr)
        .lte('date', dateToStr);

      for (const propertyId of propertyIds) {
        const hostname = getHostname(propertyId);

        // Fetch detailed (by source/medium) + daily totals (accurate KPIs) in parallel
        const [detailRows, totalRows_] = await Promise.all([
          fetchGA4Report(propertyId, dateFromStr, dateToStr),
          fetchGA4DailyTotals(propertyId, dateFromStr, dateToStr),
        ]);

        // Insert detail rows (source/medium breakdown)
        const dbDetailRows = detailRows.map(r => ({
          date: r.date, source: r.source, medium: r.medium,
          campaign: r.campaign || '', hostname: r.hostname,
          sessions: r.sessions, users: r.users, new_users: r.newUsers,
          pageviews: r.pageviews, bounce_rate: r.bounceRate,
          avg_session_duration: r.avgSessionDuration,
          transactions: r.transactions, ga_revenue: r.gaRevenue,
          ad_cost: r.adCost, ad_clicks: r.adClicks, ad_impressions: r.adImpressions,
        }));

        for (let i = 0; i < dbDetailRows.length; i += 500) {
          await db.from('fact_daily_traffic').upsert(dbDetailRows.slice(i, i + 500), {
            onConflict: 'date,source,medium,hostname,campaign',
          });
        }

        // Insert daily totals (source='__total__' for accurate KPIs matching GA4 native)
        const dbTotalRows = totalRows_.map(r => ({
          date: r.date, source: '__total__', medium: '__total__',
          campaign: '', hostname: r.hostname,
          sessions: r.sessions, users: r.users, new_users: r.newUsers,
          pageviews: r.pageviews, bounce_rate: 0, avg_session_duration: 0,
          transactions: r.transactions, ga_revenue: r.gaRevenue,
          ad_cost: r.adCost, ad_clicks: r.adClicks, ad_impressions: r.adImpressions,
        }));

        for (let i = 0; i < dbTotalRows.length; i += 500) {
          await db.from('fact_daily_traffic').upsert(dbTotalRows.slice(i, i + 500), {
            onConflict: 'date,source,medium,hostname,campaign',
          });
        }

        totalRows += detailRows.length + totalRows_.length;
        results[hostname] = detailRows.length;
      }

      // Update ETL log
      if (etlLogId) {
        await db.from('etl_log').update({
          status: 'success',
          finished_at: new Date().toISOString(),
          rows_processed: totalRows,
          rows_inserted: totalRows,
          date_range_start: dateFromStr,
          date_range_end: dateToStr,
        }).eq('id', etlLogId);
      }

      return NextResponse.json({
        success: true,
        properties: results,
        totalRows,
        dateRange: { from: dateFromStr, to: dateToStr },
      });
    } catch (err) {
      if (etlLogId) {
        await db.from('etl_log').update({
          status: 'error',
          error_message: String(err),
          finished_at: new Date().toISOString(),
        }).eq('id', etlLogId);
      }
      throw err;
    }
  } catch (err) {
    console.error('GA4 sync error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
