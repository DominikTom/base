import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchAdInsights, fetchCreativeMeta, getAdAccountIds } from '@/lib/meta-ads';

export const maxDuration = 60;

// POST — manual trigger.
// ?days=N (default 14) or ?since=YYYY-MM-DD&until=YYYY-MM-DD.
// Ad-level sync jest 3-5× droższy niż campaign-level pod względem rate limitu
// i ilości wierszy, więc default jest krótszy (14 dni zamiast 90).
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const since = searchParams.get('since');
  const until = searchParams.get('until');

  if (since && until && /^\d{4}-\d{2}-\d{2}$/.test(since) && /^\d{4}-\d{2}-\d{2}$/.test(until)) {
    return syncAdsRange(since, until);
  }

  const daysParam = parseInt(searchParams.get('days') || '14', 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 400 ? daysParam : 14;
  return syncAdsDays(days);
}

// GET — Vercel Cron daily at 6:00 UTC (po meta-sync campaign-level)
export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const cronSecret = process.env.ETL_CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // 7-dniowe okno — pokrywa attribution delay najnowszych kreacji,
  // ale nie przesadza z rate limit (ad-level jest drogie).
  return syncAdsDays(7);
}

async function syncAdsDays(daysBack: number) {
  const today = new Date();
  const dateTo = new Date(today);
  dateTo.setDate(dateTo.getDate() - 1);
  const dateFrom = new Date(today);
  dateFrom.setDate(dateFrom.getDate() - daysBack);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return syncAdsRange(fmt(dateFrom), fmt(dateTo));
}

async function syncAdsRange(dateFromStr: string, dateToStr: string) {
  try {
    const db = getSupabaseAdmin();
    const accountIds = getAdAccountIds();

    if (accountIds.length === 0) {
      return NextResponse.json({ error: 'META_AD_ACCOUNT_IDS not configured' }, { status: 500 });
    }

    const { data: etlLog } = await db
      .from('etl_log')
      .insert({ source: 'meta_ads_adlevel', started_at: new Date().toISOString(), status: 'running' })
      .select('id')
      .single();
    const etlLogId = etlLog?.id;

    try {
      // Delete existing data in range — insert będzie świeży
      await db.from('fact_daily_ad_performance').delete()
        .gte('date', dateFromStr)
        .lte('date', dateToStr);

      let totalRows = 0;
      let newCreatives = 0;
      const EUR_TO_PLN = 4.30;
      const results: Record<string, number> = {};

      for (const accountId of accountIds) {
        const rows = await fetchAdInsights(accountId, dateFromStr, dateToStr);
        const isEur = rows[0]?.currency === 'EUR';
        const rate = isEur ? EUR_TO_PLN : 1;

        const dbRows = rows.map(r => ({
          date: r.date,
          platform: 'meta',
          account_id: r.accountId,
          campaign_id: r.campaignId,
          campaign_name: r.campaignName,
          adset_id: r.adsetId,
          adset_name: r.adsetName,
          ad_id: r.adId,
          ad_name: r.adName,
          creative_id: r.creativeId,
          impressions: r.impressions,
          reach: r.reach,
          clicks: r.clicks,
          spend: Math.round(r.spend * rate * 100) / 100,
          spend_original: r.spend,
          original_currency: r.currency,
          conversions: r.conversions,
          conversion_value: Math.round(r.conversionValue * rate * 100) / 100,
          cpc: r.cpc > 0 ? Math.round(r.cpc * rate * 10000) / 10000 : null,
          cpm: r.cpm > 0 ? Math.round(r.cpm * rate * 10000) / 10000 : null,
          ctr: r.ctr > 0 ? r.ctr : null,
          roas: r.spend > 0 ? Math.round((r.conversionValue / r.spend) * 10000) / 10000 : null,
          frequency: r.frequency > 0 ? r.frequency : null,
          video_play_3s: r.videoPlay3s,
          video_p25_watched: r.videoP25,
          video_p50_watched: r.videoP50,
          video_p75_watched: r.videoP75,
          video_p95_watched: r.videoP95,
          video_p100_watched: r.videoP100,
          thruplays: r.thruplays,
          data_source: 'etl',
        }));

        for (let i = 0; i < dbRows.length; i += 500) {
          const { error } = await db.from('fact_daily_ad_performance').upsert(
            dbRows.slice(i, i + 500),
            { onConflict: 'date,platform,ad_id' }
          );
          if (error) throw new Error(`upsert fact_daily_ad_performance: ${error.message}`);
        }

        totalRows += rows.length;
        results[accountId] = rows.length;

        // Zbierz nowe creative_id-y, których nie ma w dim_creatives
        const uniqueCreativeIds = Array.from(new Set(
          rows.map(r => r.creativeId).filter((id): id is string => !!id)
        ));

        if (uniqueCreativeIds.length > 0) {
          const { data: existing } = await db
            .from('dim_creatives')
            .select('creative_id')
            .in('creative_id', uniqueCreativeIds);
          const existingSet = new Set((existing || []).map(r => r.creative_id));
          const missing = uniqueCreativeIds.filter(id => !existingSet.has(id));

          // Update last_seen_at dla istniejących
          if (existing && existing.length > 0) {
            await db.from('dim_creatives')
              .update({ last_seen_at: new Date().toISOString() })
              .in('creative_id', Array.from(existingSet));
          }

          // Dla brakujących: pobierz metadane z Meta i zainseruj
          // Ograniczenie: max 20 nowych per sync żeby nie przekroczyć 60s
          const toFetch = missing.slice(0, 20);
          for (const creativeId of toFetch) {
            const meta = await fetchCreativeMeta(creativeId, accountId);
            if (!meta) continue;
            await db.from('dim_creatives').upsert({
              creative_id: meta.creativeId,
              account_id: meta.accountId,
              title: meta.title,
              body: meta.body,
              call_to_action_type: meta.callToActionType,
              thumbnail_url: meta.thumbnailUrl,
              image_url: meta.imageUrl,
              video_id: meta.videoId,
              permalink_url: meta.permalinkUrl,
              format: meta.format,
              auto_tags: meta.autoTags,
              ai_tag_status: 'pending',
              first_seen_at: new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
            }, { onConflict: 'creative_id' });
            newCreatives += 1;
          }
        }
      }

      if (etlLogId) {
        await db.from('etl_log').update({
          status: 'success',
          finished_at: new Date().toISOString(),
          rows_processed: totalRows,
          rows_inserted: totalRows,
          date_range_start: dateFromStr,
          date_range_end: dateToStr,
          error_message: `newCreatives=${newCreatives}`,
        }).eq('id', etlLogId);
      }

      // Fire-and-forget: jeśli są nowe kreacje, tryggeruj AI tagging.
      // Nie czekamy na wynik — funkcja i tak wróci do klienta szybciej,
      // a tagger ma własny timeout 60s. Cron meta-ad-sync łapie ew. pudła.
      if (newCreatives > 0 && process.env.NEXT_PUBLIC_APP_URL) {
        const taggerUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/jobs/tag-creatives?limit=${Math.min(newCreatives, 20)}`;
        fetch(taggerUrl, {
          method: 'POST',
          headers: process.env.ETL_CRON_SECRET
            ? { authorization: `Bearer ${process.env.ETL_CRON_SECRET}` }
            : undefined,
        }).catch(err => console.warn('tag-creatives trigger failed:', err));
      }

      return NextResponse.json({
        success: true,
        accounts: results,
        totalRows,
        newCreatives,
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
    console.error('Meta ad-sync error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
