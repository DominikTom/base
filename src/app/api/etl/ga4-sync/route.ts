import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchGA4Report, fetchGA4DailyTotals, getPropertyIds, getHostname } from '@/lib/ga4';

export const maxDuration = 60;

// POST — manual trigger: 365 days of daily totals (fast, no ads)
export async function POST() {
  const _guard = await requireAdmin();
  if (_guard) return _guard;
  return syncGA4({ daysBack: 365, totalsOnly: true });
}

// GET — Vercel Cron: totals + detail for last 7 days
export async function GET(request: NextRequest) {
  const _guard = await requireAdmin();
  if (_guard) return _guard;
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.ETL_CRON_SECRET;
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return syncGA4({ daysBack: 7, totalsOnly: false });
}

async function syncGA4({ daysBack, totalsOnly }: { daysBack: number; totalsOnly: boolean }) {
  try {
    const db = getSupabaseAdmin();
    const propertyIds = getPropertyIds();

    if (propertyIds.length === 0) {
      return NextResponse.json({ error: 'GA4_PROPERTY_IDS not configured' }, { status: 500 });
    }

    const { data: etlLog } = await db
      .from('etl_log')
      .insert({ source: 'ga4', started_at: new Date().toISOString(), status: 'running' })
      .select('id')
      .single();
    const etlLogId = etlLog?.id;

    try {
      const today = new Date();
      const dateTo = new Date(today);
      dateTo.setDate(dateTo.getDate() - 1);
      const dateFrom = new Date(today);
      dateFrom.setDate(dateFrom.getDate() - daysBack);

      const fmt = (d: Date) => d.toISOString().split('T')[0];
      const dateFromStr = fmt(dateFrom);
      const dateToStr = fmt(dateTo);

      // Clean slate for manual sync, targeted delete for cron
      if (totalsOnly) {
        // Manual: delete ALL data, fresh start
        await db.from('fact_daily_traffic').delete().gte('date', '2020-01-01');
      } else {
        // Cron: delete only the date range
        await db.from('fact_daily_traffic').delete()
          .gte('date', dateFromStr).lte('date', dateToStr);
      }

      let totalRows = 0;
      const results: Record<string, number> = {};

      // Fetch ALL properties in parallel for speed
      const promises = propertyIds.map(async (propertyId) => {
        let propRows = 0;

        // Always fetch daily totals (fast: ~90 rows per property for 90 days)
        const dailyTotals = await fetchGA4DailyTotals(propertyId, dateFromStr, dateToStr);
        const dbTotalRows = dailyTotals.map(r => ({
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
        propRows += dailyTotals.length;

        // Optionally fetch detail (source/medium breakdown) — only for short ranges
        if (!totalsOnly) {
          const detailRows = await fetchGA4Report(propertyId, dateFromStr, dateToStr);
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
          propRows += detailRows.length;
        }

        return { hostname: getHostname(propertyId), rows: propRows };
      });

      const propResults = await Promise.all(promises);
      for (const r of propResults) {
        results[r.hostname] = r.rows;
        totalRows += r.rows;
      }

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
        mode: totalsOnly ? 'totals_only_90d' : 'full_7d',
      });
    } catch (err) {
      if (etlLogId) {
        await db.from('etl_log').update({
          status: 'error', error_message: String(err),
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
