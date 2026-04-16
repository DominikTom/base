import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchGA4Report, getPropertyIds, getHostname } from '@/lib/ga4';

export const maxDuration = 60;

/**
 * GA4 sync endpoint — fetches traffic data from all GA4 properties.
 * Triggered by Vercel Cron daily at 6:30 UTC, or manually.
 */
// POST — manual trigger from dashboard UI
export async function POST() {
  return syncGA4();
}

// GET — Vercel Cron trigger
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.ETL_CRON_SECRET;
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return syncGA4();
}

async function syncGA4() {
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
      // Fetch last 7 days for each property (T-1 to T-7)
      const today = new Date();
      const dateTo = new Date(today);
      dateTo.setDate(dateTo.getDate() - 1); // yesterday
      const dateFrom = new Date(today);
      dateFrom.setDate(dateFrom.getDate() - 7);

      const fmt = (d: Date) => d.toISOString().split('T')[0];
      const dateFromStr = fmt(dateFrom);
      const dateToStr = fmt(dateTo);

      let totalRows = 0;
      const results: Record<string, number> = {};

      for (const propertyId of propertyIds) {
        const hostname = getHostname(propertyId);
        const rows = await fetchGA4Report(propertyId, dateFromStr, dateToStr);

        // Delete existing data for this hostname + date range
        await db
          .from('fact_daily_traffic')
          .delete()
          .eq('hostname', hostname)
          .gte('date', dateFromStr)
          .lte('date', dateToStr);

        // Insert in batches
        const dbRows = rows.map(r => ({
          date: r.date,
          source: r.source,
          medium: r.medium,
          campaign: r.campaign || '',
          hostname: r.hostname,
          sessions: r.sessions,
          users: r.users,
          new_users: r.newUsers,
          pageviews: r.pageviews,
          bounce_rate: r.bounceRate,
          avg_session_duration: r.avgSessionDuration,
          transactions: r.transactions,
          ga_revenue: r.gaRevenue,
        }));

        for (let i = 0; i < dbRows.length; i += 500) {
          const batch = dbRows.slice(i, i + 500);
          await db.from('fact_daily_traffic').upsert(batch, {
            onConflict: 'date,source,medium,hostname,campaign',
          });
        }

        totalRows += rows.length;
        results[hostname] = rows.length;
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
