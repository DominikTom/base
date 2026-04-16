import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from') || '2025-01-01';
    const dateTo = searchParams.get('date_to') || new Date().toISOString().split('T')[0];
    const platform = searchParams.get('platform') || 'all';

    // Fetch ad spend data (WARM from DB)
    let query = getSupabaseAdmin()
      .from('fact_daily_adspend')
      .select('*')
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date', { ascending: true });

    if (platform !== 'all') {
      query = query.eq('platform', platform);
    }

    const { data: adspendData, error } = await query.limit(50000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // KPIs
    const totals = (adspendData || []).reduce(
      (acc, row) => {
        acc.spend += row.spend || 0;
        acc.impressions += row.impressions || 0;
        acc.clicks += row.clicks || 0;
        acc.conversions += row.conversions || 0;
        acc.conversionValue += row.conversion_value || 0;
        return acc;
      },
      { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 }
    );

    const avgCpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
    const avgCpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
    const avgCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
    const blendedRoas = totals.spend > 0 ? totals.conversionValue / totals.spend : 0;

    // Spend vs Revenue time series
    const dailyMap: Record<string, { spend: number; revenue: number }> = {};
    for (const row of adspendData || []) {
      if (!dailyMap[row.date]) dailyMap[row.date] = { spend: 0, revenue: 0 };
      dailyMap[row.date].spend += row.spend || 0;
      dailyMap[row.date].revenue += row.conversion_value || 0;
    }
    const spendVsRevenue = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        spend: Math.round(v.spend),
        revenue: Math.round(v.revenue),
      }));

    // ROAS trend
    const roasTrend = spendVsRevenue.map(d => ({
      name: d.date,
      value: d.spend > 0 ? Math.round((d.revenue / d.spend) * 100) / 100 : 0,
    }));

    // Spend by platform
    const platformSpend: Record<string, number> = {};
    for (const row of adspendData || []) {
      platformSpend[row.platform] = (platformSpend[row.platform] || 0) + (row.spend || 0);
    }
    const spendByPlatform = Object.entries(platformSpend)
      .map(([name, value]) => ({ name, value: Math.round(value) }));

    // Campaign table
    const campaignMap: Record<string, {
      campaign_name: string;
      platform: string;
      spend: number;
      impressions: number;
      clicks: number;
      conversions: number;
      conversion_value: number;
    }> = {};

    for (const row of adspendData || []) {
      const key = row.campaign_id;
      if (!campaignMap[key]) {
        campaignMap[key] = {
          campaign_name: row.campaign_name || row.campaign_id,
          platform: row.platform,
          spend: 0, impressions: 0, clicks: 0, conversions: 0, conversion_value: 0,
        };
      }
      const c = campaignMap[key];
      c.spend += row.spend || 0;
      c.impressions += row.impressions || 0;
      c.clicks += row.clicks || 0;
      c.conversions += row.conversions || 0;
      c.conversion_value += row.conversion_value || 0;
    }

    const campaignTable = Object.entries(campaignMap)
      .map(([id, c]) => ({
        campaign_id: id,
        ...c,
        ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
        cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
        roas: c.spend > 0 ? c.conversion_value / c.spend : 0,
      }))
      .sort((a, b) => b.spend - a.spend);

    // Top campaigns by ROAS
    const topByRoas = [...campaignTable]
      .filter(c => c.spend > 100)
      .sort((a, b) => b.roas - a.roas)
      .slice(0, 10)
      .map(c => ({ name: c.campaign_name, value: Math.round(c.roas * 100) / 100 }));

    return NextResponse.json({
      kpis: {
        totalSpend: Math.round(totals.spend),
        totalConversions: totals.conversions,
        blendedRoas: Math.round(blendedRoas * 100) / 100,
        avgCpc: Math.round(avgCpc * 100) / 100,
        avgCpm: Math.round(avgCpm * 100) / 100,
        avgCtr: Math.round(avgCtr * 100) / 100,
      },
      charts: {
        spendVsRevenue,
        roasTrend,
        spendByPlatform,
        topByRoas,
      },
      campaignTable,
    });
  } catch (err) {
    console.error('Marketing API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
