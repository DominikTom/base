import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from') || '2025-01-01';
    const dateTo = searchParams.get('date_to') || new Date().toISOString().split('T')[0];
    const shop = searchParams.get('shop') || 'all';

    // Build shop filter
    let shopFilter = {};
    if (shop !== 'all') {
      shopFilter = { source_shop: shop };
    }

    // Fetch daily revenue data
    let revenueQuery = supabaseAdmin
      .from('fact_daily_revenue')
      .select('*')
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date', { ascending: true });

    if (shop !== 'all') {
      revenueQuery = revenueQuery.eq('source_shop', shop);
    }

    const { data: dailyRevenue, error: revError } = await revenueQuery;

    if (revError) {
      return NextResponse.json({ error: revError.message }, { status: 500 });
    }

    // Aggregate KPIs
    const totals = (dailyRevenue || []).reduce(
      (acc, row) => {
        acc.revenue += row.revenue_gross_pln || 0;
        acc.orders += row.orders_count || 0;
        acc.ordersPaid += row.orders_paid || 0;
        acc.ordersCancelled += row.orders_cancelled || 0;
        acc.shipping += row.shipping_revenue_pln || 0;
        return acc;
      },
      { revenue: 0, orders: 0, ordersPaid: 0, ordersCancelled: 0, shipping: 0 }
    );

    const aov = totals.orders > 0 ? totals.revenue / totals.orders : 0;

    // Revenue by shop (for pie chart)
    const revenueByShop: Record<string, number> = {};
    for (const row of dailyRevenue || []) {
      revenueByShop[row.source_shop] = (revenueByShop[row.source_shop] || 0) + (row.revenue_gross_pln || 0);
    }

    // Revenue time series (grouped by date, split by shop)
    const revenueTimeSeries: Record<string, Record<string, number>> = {};
    for (const row of dailyRevenue || []) {
      if (!revenueTimeSeries[row.date]) {
        revenueTimeSeries[row.date] = {};
      }
      revenueTimeSeries[row.date][row.source_shop] = (revenueTimeSeries[row.date][row.source_shop] || 0) + (row.revenue_gross_pln || 0);
    }

    const shops = [...new Set((dailyRevenue || []).map(r => r.source_shop))];
    const revenueChart = Object.entries(revenueTimeSeries)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({
        date,
        ...Object.fromEntries(shops.map(s => [s, values[s] || 0])),
      }));

    // Orders time series
    const ordersTimeSeries: Record<string, number> = {};
    for (const row of dailyRevenue || []) {
      ordersTimeSeries[row.date] = (ordersTimeSeries[row.date] || 0) + (row.orders_count || 0);
    }
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
    let productsQuery = supabaseAdmin
      .from('fact_order_items')
      .select('product_name, product_category, quantity, order_id, fact_orders!inner(order_date, source_shop, total_gross_pln)')
      .gte('fact_orders.order_date', dateFrom)
      .lte('fact_orders.order_date', dateTo + 'T23:59:59')
      .not('item_type', 'in', '("shipping","service","surcharge")');

    if (shop !== 'all') {
      productsQuery = productsQuery.eq('fact_orders.source_shop', shop);
    }

    const { data: productItems } = await productsQuery.limit(10000);

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
