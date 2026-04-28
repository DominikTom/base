import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from') || '2025-01-01';
    const dateTo = searchParams.get('date_to') || new Date().toISOString().split('T')[0];
    const shop = searchParams.get('shop') || 'all';

    const CANCELLED_STATUS = 'anulowane';

    // Fetch order-level data directly to avoid stale / over-inclusive daily aggregates.
    // Revenue KPI should include only billable statuses: zamówienie + zrealizowane.
    let ordersQuery = getSupabaseAdmin()
      .from('fact_orders')
      .select('order_date, source_shop, total_gross_pln, shipping_cost_pln, is_paid, status')
      .gte('order_date', dateFrom)
      .lte('order_date', dateTo + 'T23:59:59')
      .order('order_date', { ascending: true });

    if (shop !== 'all') {
      ordersQuery = ordersQuery.eq('source_shop', shop);
    }

    const ordersData = await fetchAllRows(ordersQuery);

    const totals = { revenue: 0, orders: 0, ordersPaid: 0, ordersCancelled: 0, shipping: 0 };

    const revenueByShop: Record<string, number> = {};
    const revenueTimeSeries: Record<string, Record<string, number>> = {};
    const ordersTimeSeries: Record<string, number> = {};

    for (const row of ordersData || []) {
      const status = row.status || '';
      const date = (row.order_date as string).substring(0, 10);
      if (!date) continue;

      if (status === CANCELLED_STATUS) {
        totals.ordersCancelled += 1;
      }

      const gross = row.total_gross_pln || 0;
      totals.revenue += gross;
      totals.orders += 1;
      totals.shipping += row.shipping_cost_pln || 0;
      if (row.is_paid) totals.ordersPaid += 1;

      revenueByShop[row.source_shop] = (revenueByShop[row.source_shop] || 0) + gross;
      if (!revenueTimeSeries[date]) {
        revenueTimeSeries[date] = {};
      }
      revenueTimeSeries[date][row.source_shop] = (revenueTimeSeries[date][row.source_shop] || 0) + gross;
      ordersTimeSeries[date] = (ordersTimeSeries[date] || 0) + 1;
    }

    const aov = totals.orders > 0 ? totals.revenue / totals.orders : 0;
    const shops = [...new Set(Object.values(revenueTimeSeries).flatMap(v => Object.keys(v)))];
    const revenueChart = Object.entries(revenueTimeSeries)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({
        date,
        ...Object.fromEntries(shops.map(s => [s, values[s] || 0])),
      }));

    const ordersChart = Object.entries(ordersTimeSeries)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ name: date, value: count }));

    // Sparkline data (last 30 points of daily revenue)
    const revenueDailyTotals = Object.entries(revenueTimeSeries)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, values]) => Object.values(values).reduce((s, v) => s + v, 0));
    const revenueSparkline = revenueDailyTotals.slice(-30);

    const ordersDailyTotals = Object.entries(ordersTimeSeries)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
    const ordersSparkline = ordersDailyTotals.slice(-30);

    // Top products
    let productsQuery = getSupabaseAdmin()
      .from('fact_order_items')
      .select('product_name, product_category, quantity, order_id, fact_orders!inner(order_date, source_shop, total_gross_pln, status)')
      .gte('fact_orders.order_date', dateFrom)
      .lte('fact_orders.order_date', dateTo + 'T23:59:59')
      .not('item_type', 'in', '("shipping","service","surcharge")');

    if (shop !== 'all') {
      productsQuery = productsQuery.eq('fact_orders.source_shop', shop);
    }

    const productItems = await fetchAllRows(productsQuery);

    // Aggregate top products by order count
    const productMap: Record<string, { count: number; quantity: number; category: string }> = {};
    for (const item of productItems || []) {
      if (!productMap[item.product_name]) {
        productMap[item.product_name] = { count: 0, quantity: 0, category: item.product_category };
      }
      productMap[item.product_name].count++;
      productMap[item.product_name].quantity += item.quantity || 1;
    }

    const topProducts = Object.entries(productMap)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10)
      .map(([name, v]) => ({ name, value: v.count, category: v.category }));

    // Revenue by category
    const categoryRevenue: Record<string, number> = {};
    for (const item of productItems || []) {
      categoryRevenue[item.product_category] = (categoryRevenue[item.product_category] || 0) + (item.quantity || 1);
    }
    const categoryChart = Object.entries(categoryRevenue)
      .filter(([cat]) => !['wysyłka', 'usługa', 'dopłata'].includes(cat))
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));

    return NextResponse.json({
      kpis: {
        revenue: totals.revenue,
        orders: totals.orders,
        ordersPaid: totals.ordersPaid,
        ordersCancelled: totals.ordersCancelled,
        aov,
        shipping: totals.shipping,
      },
      sparklines: {
        revenue: revenueSparkline,
        orders: ordersSparkline,
      },
      charts: {
        revenueByShop: Object.entries(revenueByShop).map(([name, value]) => ({ name, value })),
        revenueTimeSeries: revenueChart,
        ordersTimeSeries: ordersChart,
        topProducts,
        categoryBreakdown: categoryChart,
      },
      shops,
      dateRange: { from: dateFrom, to: dateTo },
    });
  } catch (err) {
    console.error('Overview API error:', err);
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
