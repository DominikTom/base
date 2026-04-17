import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { EUR_TO_PLN } from '@/lib/currency';

export const maxDuration = 60;

export async function POST() {
  try {
    const db = getSupabaseAdmin();

    // Batch update all EUR orders with exchange_rate=1 using a single SQL call
    const { data: updateResult, error: updateError } = await db.rpc('backfill_eur_orders', {
      new_rate: EUR_TO_PLN,
    });

    // If RPC doesn't exist, fall back to direct SQL via postgrest
    let updated = 0;
    if (updateError) {
      // Fallback: use batch update via Supabase update with filter
      // First count how many need updating
      const { count } = await db.from('fact_orders')
        .select('order_id', { count: 'exact', head: true })
        .eq('currency', 'EUR')
        .eq('exchange_rate', 1);

      updated = count || 0;

      if (updated > 0) {
        // Supabase update with filter updates ALL matching rows in one query
        const { error } = await db.from('fact_orders')
          .update({
            exchange_rate: EUR_TO_PLN,
          })
          .eq('currency', 'EUR')
          .eq('exchange_rate', 1);

        if (error) throw new Error(`Update exchange_rate failed: ${error.message}`);

        // Now update PLN amounts — need to read and batch update
        const PAGE = 1000;
        let offset = 0;
        while (true) {
          const { data: orders } = await db.from('fact_orders')
            .select('order_id, total_gross, shipping_cost')
            .eq('currency', 'EUR')
            .eq('exchange_rate', EUR_TO_PLN)
            .range(offset, offset + PAGE - 1);

          if (!orders || orders.length === 0) break;

          // Batch: build array of updates and upsert
          const updates = orders.map(o => ({
            order_id: o.order_id,
            total_gross_pln: o.total_gross != null ? Math.round(o.total_gross * EUR_TO_PLN * 100) / 100 : null,
            shipping_cost_pln: o.shipping_cost != null ? Math.round(o.shipping_cost * EUR_TO_PLN * 100) / 100 : null,
          }));

          // Upsert in batches
          for (const u of updates) {
            await db.from('fact_orders')
              .update({ total_gross_pln: u.total_gross_pln, shipping_cost_pln: u.shipping_cost_pln })
              .eq('order_id', u.order_id);
          }

          if (orders.length < PAGE) break;
          offset += PAGE;
        }
      }
    } else {
      updated = typeof updateResult === 'number' ? updateResult : 0;
    }

    // Rebuild fact_daily_revenue for EUR shops only
    const eurShops = ['mybed.de', 'amazon.de', 'kaufland.de'];
    const PAGE = 1000;

    for (const eurShop of eurShops) {
      // Get all orders for this shop, paginated
      const dailyMap: Record<string, {
        orders_count: number; orders_paid: number; orders_cancelled: number;
        revenue_gross_pln: number; revenue_paid_pln: number; shipping_revenue_pln: number;
        revenue_gross_original: number;
      }> = {};

      let offset = 0;
      while (true) {
        const { data: orders } = await db.from('fact_orders')
          .select('order_date, total_gross, total_gross_pln, shipping_cost_pln, is_paid, status')
          .eq('source_shop', eurShop)
          .range(offset, offset + PAGE - 1);

        if (!orders || orders.length === 0) break;

        for (const o of orders) {
          const date = (o.order_date as string).substring(0, 10);
          if (!dailyMap[date]) {
            dailyMap[date] = {
              orders_count: 0, orders_paid: 0, orders_cancelled: 0,
              revenue_gross_pln: 0, revenue_paid_pln: 0, shipping_revenue_pln: 0,
              revenue_gross_original: 0,
            };
          }
          const g = dailyMap[date];
          g.orders_count++;
          if (o.is_paid) g.orders_paid++;
          if (o.status === 'anulowane') g.orders_cancelled++;
          g.revenue_gross_pln += o.total_gross_pln || 0;
          if (o.is_paid) g.revenue_paid_pln += o.total_gross_pln || 0;
          g.shipping_revenue_pln += o.shipping_cost_pln || 0;
          g.revenue_gross_original += o.total_gross || 0;
        }

        if (orders.length < PAGE) break;
        offset += PAGE;
      }

      // Delete old daily revenue for this shop and re-insert
      await db.from('fact_daily_revenue').delete().eq('source_shop', eurShop);

      const rows = Object.entries(dailyMap).map(([date, g]) => ({
        date,
        source_shop: eurShop,
        orders_count: g.orders_count,
        orders_paid: g.orders_paid,
        orders_cancelled: g.orders_cancelled,
        revenue_gross_pln: Math.round(g.revenue_gross_pln * 100) / 100,
        revenue_paid_pln: Math.round(g.revenue_paid_pln * 100) / 100,
        shipping_revenue_pln: Math.round(g.shipping_revenue_pln * 100) / 100,
        avg_order_value_pln: g.orders_count > 0 ? Math.round((g.revenue_gross_pln / g.orders_count) * 100) / 100 : 0,
        revenue_gross_original: Math.round(g.revenue_gross_original * 100) / 100,
        original_currency: 'EUR',
      }));

      // Insert in batches of 500
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        await db.from('fact_daily_revenue').insert(batch);
      }
    }

    return NextResponse.json({ success: true, updated, rate: EUR_TO_PLN });
  } catch (err) {
    console.error('Backfill EUR error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
