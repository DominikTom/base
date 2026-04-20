import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchCampaignInsights, getAdAccountIds } from '@/lib/meta-ads';

export const maxDuration = 60;

// POST — manual trigger (90 days)
export async function POST() {
  return syncMeta(90);
}

// GET — Vercel Cron daily at 5:00 UTC
export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const cronSecret = process.env.ETL_CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // 28-day window covers Meta's attribution lookback so late-reported
  // conversions retroactively update historical rows.
  return syncMeta(28);
}

async function syncMeta(daysBack: number) {
  try {
    const db = getSupabaseAdmin();
    const accountIds = getAdAccountIds();

    if (accountIds.length === 0) {
      return NextResponse.json({ error: 'META_AD_ACCOUNT_IDS not configured' }, { status: 500 });
    }

    const { data: etlLog } = await db
      .from('etl_log')
      .insert({ source: 'meta_ads', started_at: new Date().toISOString(), status: 'running' })
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

      // Delete existing meta data in range
      await db.from('fact_daily_adspend').delete()
        .eq('platform', 'meta')
        .gte('date', dateFromStr)
        .lte('date', dateToStr);

      let totalRows = 0;
      const results: Record<string, number> = {};

      for (const accountId of accountIds) {
        const rows = await fetchCampaignInsights(accountId, dateFromStr, dateToStr);

        // EUR→PLN conversion rate (rough, should use NBP)
        const EUR_TO_PLN = 4.30;

        const dbRows = rows.map(r => {
          const isEur = r.currency === 'EUR';
          const rate = isEur ? EUR_TO_PLN : 1;
          return {
            date: r.date,
            platform: 'meta',
            campaign_id: r.campaignId,
            campaign_name: r.campaignName,
            adset_name: r.adsetName,
            impressions: r.impressions,
            clicks: r.clicks,
            spend: Math.round(r.spend * rate * 100) / 100,
            spend_original: r.spend,
            original_currency: r.currency,
            conversions: r.conversions,
            conversion_value: Math.round(r.conversionValue * rate * 100) / 100,
            cpc: r.cpc > 0 ? Math.round(r.cpc * rate * 100) / 100 : null,
            cpm: r.cpm > 0 ? Math.round(r.cpm * rate * 100) / 100 : null,
            ctr: r.ctr > 0 ? r.ctr : null,
            roas: r.spend > 0 ? Math.round((r.conversionValue / r.spend) * 100) / 100 : null,
            account_id: r.accountId,
            data_source: 'etl',
          };
        });

        for (let i = 0; i < dbRows.length; i += 500) {
          await db.from('fact_daily_adspend').upsert(dbRows.slice(i, i + 500), {
            onConflict: 'date,platform,campaign_id',
          });
        }

        totalRows += rows.length;
        results[accountId] = rows.length;
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

      return NextResponse.json({ success: true, accounts: results, totalRows, dateRange: { from: dateFromStr, to: dateToStr } });
    } catch (err) {
      if (etlLogId) {
        await db.from('etl_log').update({
          status: 'error', error_message: String(err), finished_at: new Date().toISOString(),
        }).eq('id', etlLogId);
      }
      throw err;
    }
  } catch (err) {
    console.error('Meta sync error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
