import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// GET /api/dashboard/marketing/ad-daily?ad_id=...&date_from&date_to
//
// Dzienna seria pojedynczej reklamy do wykresu w modalu podglądu kreacji.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const adId = searchParams.get('ad_id') || '';
    const dateFrom = searchParams.get('date_from') || '2025-01-01';
    const dateTo = searchParams.get('date_to') || new Date().toISOString().split('T')[0];

    if (!/^\d+$/.test(adId)) {
      return NextResponse.json({ error: 'Invalid ad_id' }, { status: 400 });
    }

    const { data, error } = await getSupabaseAdmin()
      .from('fact_daily_ad_performance')
      .select('date, spend, impressions, clicks, conversions, conversion_value, leads')
      .eq('platform', 'meta')
      .eq('ad_id', adId)
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date', { ascending: true });
    if (error) throw new Error(error.message);

    const daily = (data || []).map(r => ({
      date: r.date as string,
      spend: Math.round(((r.spend as number) || 0) * 100) / 100,
      impressions: (r.impressions as number) || 0,
      clicks: (r.clicks as number) || 0,
      purchases: (r.conversions as number) || 0,
      revenue: Math.round(((r.conversion_value as number) || 0) * 100) / 100,
      leads: (r.leads as number) || 0,
    }));

    return NextResponse.json({ ad_id: adId, daily });
  } catch (err) {
    console.error('ad-daily error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
