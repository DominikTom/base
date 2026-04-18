import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getMonthlyRates, EUR_TO_PLN_FALLBACK } from '@/lib/currency';

export const maxDuration = 60;

export async function POST() {
  try {
    const db = getSupabaseAdmin();
    const PAGE = 1000;

    // Find date range of EUR orders with exchange_rate=1
    const { data: earliest } = await db.from('fact_orders')
      .select('order_date').eq('currency', 'EUR').eq('exchange_rate', 1)
      .order('order_date', { ascending: true }).limit(1);
    const { data: latest } = await db.from('fact_orders')
      .select('order_date').eq('currency', 'EUR').eq('exchange_rate', 1)
      .order('order_date', { ascending: false }).limit(1);

    if (!earliest?.[0] || !latest?.[0]) {
      return NextResponse.json({ success: true, updated: 0, message: 'No EUR orders with rate=1 found' });
    }

    const startMonth = (earliest[0].order_date as string).substring(0, 7);
    const endMonth = (latest[0].order_date as string).substring(0, 7);

    // Fetch monthly average EUR/PLN rates from NBP
    const monthlyRates = await getMonthlyRates(startMonth, endMonth);
    const ratesUsed: Record<string, number> = {};
    for (const [k, v] of monthlyRates) ratesUsed[k] = v;

    // Update orders month by month
    let updated = 0;
    for (const [month, rate] of monthlyRates) {
      const monthStart = `${month}-01`;
      const monthEnd = `${month}-31T23:59:59`;

      let offset = 0;
      while (true) {
        const { data: orders } = await db.from('fact_orders')
          .select('order_id, total_gross, shipping_cost')
          .eq('currency', 'EUR').eq('exchange_rate', 1)
          .gte('order_date', monthStart).lte('order_date', monthEnd)
          .range(offset, offset + PAGE - 1);

        if (!orders || orders.length === 0) break;

        for (const o of orders) {
          await db.from('fact_orders').update({
            exchange_rate: rate,
            total_gross_pln: o.total_gross != null ? Math.round(o.total_gross * rate * 100) / 100 : null,
            shipping_cost_pln: o.shipping_cost != null ? Math.round(o.shipping_cost * rate * 100) / 100 : null,
          }).eq('order_id', o.order_id);
          updated++;
        }

        if (orders.length < PAGE) break;
        offset += PAGE;
      }
    }

    // Rebuild fact_daily_revenue for EUR shops
    const eurShops = ['mybed.de', 'amazon.de', 'kaufland.de'];
    for (const eurShop of eurShops) {
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

      for (let i = 0; i < rows.length; i += 500) {
        await db.from('fact_daily_revenue').insert(rows.slice(i, i + 500));
      }
    }

    return NextResponse.json({ success: true, updated, ratesUsed });
  } catch (err) {
    console.error('Backfill EUR error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// GET — show current EUR/PLN rate from NBP
export async function GET() {
  try {
    const res = await fetch('https://api.nbp.pl/api/exchangerates/rates/a/eur/?format=json', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const json = await res.json();
      const rate = json.rates?.[0];
      return NextResponse.json({ rate: rate?.mid, date: rate?.effectiveDate, table: rate?.no });
    }
    return NextResponse.json({ rate: EUR_TO_PLN_FALLBACK, date: null, fallback: true });
  } catch {
    return NextResponse.json({ rate: EUR_TO_PLN_FALLBACK, date: null, fallback: true });
  }
}
