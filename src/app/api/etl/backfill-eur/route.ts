import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { EUR_TO_PLN } from '@/lib/currency';

export async function POST() {
  try {
    const db = getSupabaseAdmin();

    // Find all EUR orders with exchange_rate=1 (unconverted)
    const PAGE = 1000;
    let offset = 0;
    let updated = 0;

    while (true) {
      const { data: orders } = await db.from('fact_orders')
        .select('order_id, total_gross, shipping_cost')
        .eq('currency', 'EUR')
        .eq('exchange_rate', 1)
        .range(offset, offset + PAGE - 1);

      if (!orders || orders.length === 0) break;

      for (const o of orders) {
        const totalGrossPln = o.total_gross != null ? o.total_gross * EUR_TO_PLN : null;
        const shippingCostPln = o.shipping_cost != null ? o.shipping_cost * EUR_TO_PLN : null;

        await db.from('fact_orders').update({
          exchange_rate: EUR_TO_PLN,
          total_gross_pln: totalGrossPln,
          shipping_cost_pln: shippingCostPln,
        }).eq('order_id', o.order_id);

        updated++;
      }

      if (orders.length < PAGE) break;
      offset += PAGE;
    }

    // Rebuild fact_daily_revenue for all dates
    // Get date range of affected orders
    const { data: dateRange } = await db.from('fact_orders')
      .select('order_date')
      .eq('currency', 'EUR')
      .order('order_date', { ascending: true })
      .limit(1);

    const { data: dateRangeEnd } = await db.from('fact_orders')
      .select('order_date')
      .eq('currency', 'EUR')
      .order('order_date', { ascending: false })
      .limit(1);

    if (dateRange?.[0] && dateRangeEnd?.[0]) {
      const startDate = (dateRange[0].order_date as string).substring(0, 10);
      const endDate = (dateRangeEnd[0].order_date as string).substring(0, 10);

      // Delete existing daily revenue for the affected date range and rebuild
      await db.from('fact_daily_revenue')
        .delete()
        .gte('date', startDate)
        .lte('date', endDate);

      // Fetch all orders in range and rebuild
      let rebuildOffset = 0;
      const dailyMap: Record<string, Record<string, {
        orders_count: number; orders_paid: number; orders_cancelled: number;
        revenue_gross_pln: number; revenue_paid_pln: number; shipping_revenue_pln: number;
        revenue_gross_original: number; original_currency: string;
      }>> = {};

      while (true) {
        const { data: orders } = await db.from('fact_orders')
          .select('order_date, source_shop, total_gross, total_gross_pln, shipping_cost_pln, is_paid, status, currency')
          .gte('order_date', startDate)
          .lte('order_date', endDate + 'T23:59:59')
          .range(rebuildOffset, rebuildOffset + PAGE - 1);

        if (!orders || orders.length === 0) break;

        for (const o of orders) {
          const date = (o.order_date as string).substring(0, 10);
          const shop = o.source_shop || 'unknown';
          const key = `${date}|${shop}`;

          if (!dailyMap[date]) dailyMap[date] = {};
          if (!dailyMap[date][shop]) {
            dailyMap[date][shop] = {
              orders_count: 0, orders_paid: 0, orders_cancelled: 0,
              revenue_gross_pln: 0, revenue_paid_pln: 0, shipping_revenue_pln: 0,
              revenue_gross_original: 0, original_currency: o.currency || 'PLN',
            };
          }

          const g = dailyMap[date][shop];
          g.orders_count++;
          if (o.is_paid) g.orders_paid++;
          if (o.status === 'anulowane') g.orders_cancelled++;
          g.revenue_gross_pln += o.total_gross_pln || 0;
          if (o.is_paid) g.revenue_paid_pln += o.total_gross_pln || 0;
          g.shipping_revenue_pln += o.shipping_cost_pln || 0;
          g.revenue_gross_original += o.total_gross || 0;
        }

        if (orders.length < PAGE) break;
        rebuildOffset += PAGE;
      }

      // Upsert daily revenue
      for (const [date, shops] of Object.entries(dailyMap)) {
        for (const [shop, g] of Object.entries(shops)) {
          const avgOrder = g.orders_count > 0 ? g.revenue_gross_pln / g.orders_count : 0;
          await db.from('fact_daily_revenue').upsert({
            date,
            source_shop: shop,
            orders_count: g.orders_count,
            orders_paid: g.orders_paid,
            orders_cancelled: g.orders_cancelled,
            revenue_gross_pln: Math.round(g.revenue_gross_pln * 100) / 100,
            revenue_paid_pln: Math.round(g.revenue_paid_pln * 100) / 100,
            shipping_revenue_pln: Math.round(g.shipping_revenue_pln * 100) / 100,
            avg_order_value_pln: Math.round(avgOrder * 100) / 100,
            revenue_gross_original: Math.round(g.revenue_gross_original * 100) / 100,
            original_currency: g.original_currency,
          }, { onConflict: 'date, source_shop' });
        }
      }
    }

    return NextResponse.json({ success: true, updated, rate: EUR_TO_PLN });
  } catch (err) {
    console.error('Backfill EUR error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
