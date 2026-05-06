import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from') || '2025-01-01';
    const dateTo = searchParams.get('date_to') || new Date().toISOString().split('T')[0];
    const shop = searchParams.get('shop') || 'all';
    const granularity = searchParams.get('granularity') || 'day';

    // Fetch orders directly (status segmentation is handled in separate analyses).
    let query = getSupabaseAdmin()
      .from('fact_orders')
      .select('order_date, source_shop, total_gross_pln, status, is_paid, coupon_code')
      .gte('order_date', dateFrom)
      .lte('order_date', dateTo + 'T23:59:59')
      .order('order_date', { ascending: true });

    if (shop !== 'all') {
      query = query.eq('source_shop', shop);
    }

    const ordersData = await fetchAllRows(query);

    // Group by granularity
    function getGranularityKey(date: string): string {
      const d = new Date(date);
      switch (granularity) {
        case 'week': {
          const startOfWeek = new Date(d);
          startOfWeek.setDate(d.getDate() - ((d.getDay() + 6) % 7));
          return startOfWeek.toISOString().split('T')[0];
        }
        case 'month':
          return date.substring(0, 7);
        case 'quarter': {
          const q = Math.floor(d.getMonth() / 3) + 1;
          return `${d.getFullYear()}-Q${q}`;
        }
        default:
          return date;
      }
    }

    // Revenue per shop over time (stacked)
    const timeSeriesMap: Record<string, Record<string, number>> = {};
    const shopSet = new Set<string>();
    for (const row of ordersData || []) {
      const date = (row.order_date as string).substring(0, 10);
      if (!date) continue;
      const key = getGranularityKey(date);
      if (!timeSeriesMap[key]) timeSeriesMap[key] = {};
      timeSeriesMap[key][row.source_shop] = (timeSeriesMap[key][row.source_shop] || 0) + (row.total_gross_pln || 0);
      shopSet.add(row.source_shop);
    }
    const shops = [...shopSet];
    const revenueByShopTimeSeries = Object.entries(timeSeriesMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({
        date,
        ...Object.fromEntries(shops.map(s => [s, Math.round(values[s] || 0)])),
      }));

    // Producer revenue ranking — uses v_orders_with_producer view
    // (8-tag whitelist with fallback to fact_orders.supplier).
    let producerQuery = getSupabaseAdmin()
      .from('v_orders_with_producer')
      .select('producer, total_gross_pln')
      .gte('order_date', dateFrom)
      .lte('order_date', dateTo + 'T23:59:59')
      .not('producer', 'is', null);

    if (shop !== 'all') {
      producerQuery = producerQuery.eq('source_shop', shop);
    }

    const producerData = await fetchAllRows(producerQuery);
    const supplierMap: Record<string, number> = {};
    for (const o of producerData || []) {
      if (o.producer) {
        supplierMap[o.producer] = (supplierMap[o.producer] || 0) + (o.total_gross_pln || 0);
      }
    }
    const supplierRanking = Object.entries(supplierMap)
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name, value: Math.round(value) }));

    // Order status funnel
    let statusQuery = getSupabaseAdmin()
      .from('fact_orders')
      .select('status, is_paid')
      .gte('order_date', dateFrom)
      .lte('order_date', dateTo + 'T23:59:59');

    if (shop !== 'all') {
      statusQuery = statusQuery.eq('source_shop', shop);
    }

    const statusData = await fetchAllRows(statusQuery);
    const statusCounts: Record<string, number> = {};
    let paidCount = 0;
    for (const o of statusData || []) {
      statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
      if (o.is_paid) paidCount++;
    }

    const totalOrders = (statusData || []).length;
    const paymentRate = totalOrders > 0 ? (paidCount / totalOrders) * 100 : 0;

    // AOV trend
    const aovTrend: Record<string, { revenue: number; count: number }> = {};
    for (const row of ordersData || []) {
      const date = (row.order_date as string).substring(0, 10);
      if (!date) continue;
      const key = getGranularityKey(date);
      if (!aovTrend[key]) aovTrend[key] = { revenue: 0, count: 0 };
      aovTrend[key].revenue += row.total_gross_pln || 0;
      aovTrend[key].count += 1;
    }
    const aovChart = Object.entries(aovTrend)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        name: date,
        value: v.count > 0 ? Math.round(v.revenue / v.count) : 0,
      }));

    // Coupon analysis — billable view excludes cancelled orders
    let couponQuery = getSupabaseAdmin()
      .from('v_orders_billable')
      .select('coupon_code, total_gross_pln')
      .gte('order_date', dateFrom)
      .lte('order_date', dateTo + 'T23:59:59')
      .not('coupon_code', 'is', null);

    if (shop !== 'all') {
      couponQuery = couponQuery.eq('source_shop', shop);
    }

    const couponData = await fetchAllRows(couponQuery);
    const couponMap: Record<string, { count: number; revenue: number }> = {};
    for (const o of couponData || []) {
      if (o.coupon_code) {
        const code = o.coupon_code.trim().toLowerCase();
        if (!couponMap[code]) couponMap[code] = { count: 0, revenue: 0 };
        couponMap[code].count++;
        couponMap[code].revenue += o.total_gross_pln || 0;
      }
    }
    const couponAnalysis = Object.entries(couponMap)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 20)
      .map(([code, v]) => ({ code, count: v.count, revenue: Math.round(v.revenue) }));

    return NextResponse.json({
      revenueByShopTimeSeries,
      shops,
      supplierRanking,
      statusFunnel: statusCounts,
      paymentRate: Math.round(paymentRate * 10) / 10,
      aovTrend: aovChart,
      couponAnalysis,
      granularity,
    });
  } catch (err) {
    console.error('Revenue API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function fetchAllRows(baseQuery: any): Promise<any[]> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out: any[] = [];
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error }: { data: any[] | null; error: { message: string } | null } = await baseQuery.range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) break;
        out.push(...data);
        if (data.length < PAGE) break;
        offset += PAGE;
      }
      return out;
    }
