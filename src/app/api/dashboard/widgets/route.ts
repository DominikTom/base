import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { widget, dateFrom, dateTo, shop = 'all', limit = 20 } = await request.json();
    const db = getSupabaseAdmin();

    // Helper: build order date filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function orderQuery(select: string): any {
      let q = db.from('fact_orders').select(select)
        .gte('order_date', dateFrom).lte('order_date', dateTo + 'T23:59:59');
      if (shop !== 'all') q = q.eq('source_shop', shop);
      return q;
    }

    // Helper: build items query with join
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function itemsQuery(select: string, extraFilter?: (q: any) => any): any {
      let q = db.from('fact_order_items')
        .select(select + ', fact_orders!inner(order_date, source_shop)')
        .gte('fact_orders.order_date', dateFrom)
        .lte('fact_orders.order_date', dateTo + 'T23:59:59')
        .neq('fact_orders.status', 'anulowane');
      if (shop !== 'all') q = q.eq('fact_orders.source_shop', shop);
      if (extraFilter) q = extraFilter(q);
      return q;
    }

    switch (widget) {
      // ── KPI Cards ──
      case 'kpi_revenue':
      case 'kpi_revenue_paid':
      case 'kpi_revenue_unpaid':
      case 'kpi_orders':
      case 'kpi_orders_beds':
      case 'kpi_orders_samples':
      case 'kpi_aov':
      case 'kpi_payment_rate': {
        let q = db.from('fact_daily_revenue').select('*')
          .gte('date', dateFrom).lte('date', dateTo);
        if (shop !== 'all') q = q.eq('source_shop', shop);
        const { data } = await q.limit(50000);
        const rows = data || [];

        const totals = rows.reduce((a, r) => ({
          revenue: a.revenue + (r.revenue_gross_pln || 0),
          paid: a.paid + (r.revenue_paid_pln || 0),
          orders: a.orders + (r.orders_count || 0),
          ordersPaid: a.ordersPaid + (r.orders_paid || 0),
          cancelled: a.cancelled + (r.orders_cancelled || 0),
        }), { revenue: 0, paid: 0, orders: 0, ordersPaid: 0, cancelled: 0 });

        const unpaid = totals.revenue - totals.paid;
        const aov = totals.orders > 0 ? totals.revenue / totals.orders : 0;
        const paymentRate = totals.orders > 0 ? (totals.ordersPaid / totals.orders) * 100 : 0;

        // For bed/sample counts, query items
        let bedOrders = 0, sampleOrders = 0;
        if (widget === 'kpi_orders_beds' || widget === 'kpi_orders_samples') {
          const { data: items } = await itemsQuery('order_id, product_category').limit(50000);
          const bedSet = new Set<string>();
          const sampleSet = new Set<string>();
          for (const item of items || []) {
            if (item.product_category === 'łóżko') bedSet.add(item.order_id);
            if (item.product_category === 'próbki') sampleSet.add(item.order_id);
          }
          bedOrders = bedSet.size;
          sampleOrders = sampleSet.size;
        }

        const valueMap: Record<string, { value: number; format: string }> = {
          kpi_revenue: { value: totals.revenue, format: 'currency' },
          kpi_revenue_paid: { value: totals.paid, format: 'currency' },
          kpi_revenue_unpaid: { value: unpaid, format: 'currency' },
          kpi_orders: { value: totals.orders, format: 'number' },
          kpi_orders_beds: { value: bedOrders, format: 'number' },
          kpi_orders_samples: { value: sampleOrders, format: 'number' },
          kpi_aov: { value: aov, format: 'currency' },
          kpi_payment_rate: { value: paymentRate, format: 'percent' },
        };

        return NextResponse.json({ type: 'kpi', ...valueMap[widget] });
      }

      // ── Rankings ──
      case 'ranking_models': {
        const { data } = await itemsQuery('product_name, quantity')
          .eq('product_category', 'łóżko')
          .limit(50000);
        const map: Record<string, number> = {};
        for (const i of data || []) map[i.product_name] = (map[i.product_name] || 0) + (i.quantity || 1);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        const total = ranked.reduce((s,[,v]) => s + v, 0);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total });
      }

      case 'ranking_fabric_collections': {
        const { data } = await itemsQuery('fabric_collection, quantity')
          .not('fabric_collection', 'is', null)
          .limit(50000);
        const map: Record<string, number> = {};
        for (const i of data || []) if (i.fabric_collection) map[i.fabric_collection] = (map[i.fabric_collection] || 0) + (i.quantity || 1);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        const total = ranked.reduce((s,[,v]) => s + v, 0);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total });
      }

      case 'ranking_fabrics': {
        const { data } = await itemsQuery('fabric, quantity')
          .not('fabric', 'is', null)
          .limit(50000);
        const map: Record<string, number> = {};
        for (const i of data || []) if (i.fabric) map[i.fabric] = (map[i.fabric] || 0) + (i.quantity || 1);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        const total = ranked.reduce((s,[,v]) => s + v, 0);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total });
      }

      case 'ranking_cities': {
        const { data } = await orderQuery('delivery_city').not('delivery_city', 'is', null).limit(50000);
        const map: Record<string, number> = {};
        for (const o of data || []) if (o.delivery_city) map[o.delivery_city] = (map[o.delivery_city] || 0) + 1;
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value })), total: ranked.reduce((s,[,v]) => s + v, 0) });
      }

      case 'ranking_suppliers': {
        const { data } = await orderQuery('supplier, total_gross_pln').not('supplier', 'is', null).limit(50000);
        const map: Record<string, number> = {};
        for (const o of data || []) if (o.supplier) map[o.supplier] = (map[o.supplier] || 0) + (o.total_gross_pln || 0);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total: ranked.reduce((s,[,v]) => s + v, 0), format: 'currency' });
      }

      case 'ranking_coupons': {
        const { data } = await orderQuery('coupon_code').not('coupon_code', 'is', null).limit(50000);
        const map: Record<string, number> = {};
        for (const o of data || []) if (o.coupon_code) { const c = o.coupon_code.trim().toUpperCase(); map[c] = (map[c] || 0) + 1; }
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value })), total: ranked.reduce((s,[,v]) => s + v, 0) });
      }

      case 'ranking_bed_sizes': {
        const { data } = await itemsQuery('bed_size, quantity').not('bed_size', 'is', null).limit(50000);
        const map: Record<string, number> = {};
        for (const i of data || []) if (i.bed_size) map[i.bed_size] = (map[i.bed_size] || 0) + (i.quantity || 1);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total: ranked.reduce((s,[,v]) => s + v, 0) });
      }

      case 'ranking_headboard_heights': {
        const { data } = await itemsQuery('headboard_height, quantity').not('headboard_height', 'is', null).limit(50000);
        const map: Record<string, number> = {};
        for (const i of data || []) if (i.headboard_height) map[i.headboard_height] = (map[i.headboard_height] || 0) + (i.quantity || 1);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total: ranked.reduce((s,[,v]) => s + v, 0) });
      }

      case 'ranking_storage_types': {
        const { data } = await itemsQuery('storage_type, quantity').not('storage_type', 'is', null).limit(50000);
        const map: Record<string, number> = {};
        for (const i of data || []) if (i.storage_type) map[i.storage_type] = (map[i.storage_type] || 0) + (i.quantity || 1);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total: ranked.reduce((s,[,v]) => s + v, 0) });
      }

      // ── Charts ──
      case 'chart_orders_timeline':
      case 'chart_daily_orders': {
        let q = db.from('fact_daily_revenue').select('date, orders_count')
          .gte('date', dateFrom).lte('date', dateTo).order('date');
        if (shop !== 'all') q = q.eq('source_shop', shop);
        const { data } = await q.limit(50000);
        const byDate: Record<string, number> = {};
        for (const r of data || []) byDate[r.date] = (byDate[r.date] || 0) + (r.orders_count || 0);
        const chartData = Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b))
          .map(([name, value]) => ({ name, value }));
        return NextResponse.json({ type: widget === 'chart_daily_orders' ? 'bar' : 'line', data: chartData });
      }

      case 'chart_revenue_timeline': {
        let q = db.from('fact_daily_revenue').select('date, source_shop, revenue_gross_pln')
          .gte('date', dateFrom).lte('date', dateTo).order('date');
        if (shop !== 'all') q = q.eq('source_shop', shop);
        const { data } = await q.limit(50000);
        const shopSet = new Set<string>();
        const byDate: Record<string, Record<string, number>> = {};
        for (const r of data || []) {
          if (!byDate[r.date]) byDate[r.date] = {};
          byDate[r.date][r.source_shop] = (byDate[r.date][r.source_shop] || 0) + (r.revenue_gross_pln || 0);
          shopSet.add(r.source_shop);
        }
        const shops = [...shopSet];
        const chartData = Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b))
          .map(([date, vals]) => ({ date, ...Object.fromEntries(shops.map(s => [s, Math.round(vals[s] || 0)])) }));
        return NextResponse.json({ type: 'area', data: chartData, shops });
      }

      case 'chart_payment_status': {
        let q = db.from('fact_daily_revenue').select('revenue_paid_pln, revenue_gross_pln')
          .gte('date', dateFrom).lte('date', dateTo);
        if (shop !== 'all') q = q.eq('source_shop', shop);
        const { data } = await q.limit(50000);
        let paid = 0, total = 0;
        for (const r of data || []) { paid += r.revenue_paid_pln || 0; total += r.revenue_gross_pln || 0; }
        return NextResponse.json({ type: 'pie', data: [
          { name: 'Zapłacone', value: Math.round(paid) },
          { name: 'Nieopłacone', value: Math.round(total - paid) },
        ]});
      }

      case 'chart_suppliers': {
        const { data } = await orderQuery('supplier, total_gross_pln').not('supplier', 'is', null).limit(50000);
        const map: Record<string, number> = {};
        for (const o of data || []) if (o.supplier) map[o.supplier] = (map[o.supplier] || 0) + (o.total_gross_pln || 0);
        const sorted = Object.entries(map).sort(([,a],[,b]) => b - a);
        const top = sorted.slice(0, 8);
        const other = sorted.slice(8).reduce((s,[,v]) => s + v, 0);
        const chartData = top.map(([name, value]) => ({ name, value: Math.round(value) }));
        if (other > 0) chartData.push({ name: 'Inne', value: Math.round(other) });
        return NextResponse.json({ type: 'pie', data: chartData });
      }

      case 'chart_mattress_types': {
        const { data } = await itemsQuery('mattress_type, quantity').not('mattress_type', 'is', null).limit(50000);
        const map: Record<string, number> = {};
        for (const i of data || []) if (i.mattress_type) map[i.mattress_type] = (map[i.mattress_type] || 0) + (i.quantity || 1);
        const sorted = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, 10);
        return NextResponse.json({ type: 'pie', data: sorted.map(([name, value]) => ({ name, value: Math.round(value) })) });
      }

      // ── Tables ──
      case 'table_payment_status': {
        let q = db.from('fact_daily_revenue').select('orders_paid, orders_count, revenue_paid_pln, revenue_gross_pln')
          .gte('date', dateFrom).lte('date', dateTo);
        if (shop !== 'all') q = q.eq('source_shop', shop);
        const { data } = await q.limit(50000);
        let paid = 0, unpaidRev = 0, paidCount = 0, unpaidCount = 0;
        for (const r of data || []) {
          paid += r.revenue_paid_pln || 0;
          unpaidRev += (r.revenue_gross_pln || 0) - (r.revenue_paid_pln || 0);
          paidCount += r.orders_paid || 0;
          unpaidCount += (r.orders_count || 0) - (r.orders_paid || 0);
        }
        return NextResponse.json({ type: 'table', columns: ['Status', 'Zamówienia', 'Kwota'], data: [
          { status: 'Zapłacone', count: paidCount, amount: Math.round(paid) },
          { status: 'Nieopłacone', count: unpaidCount, amount: Math.round(unpaidRev) },
        ]});
      }

      default:
        return NextResponse.json({ error: `Unknown widget: ${widget}` }, { status: 400 });
    }
  } catch (err) {
    console.error('Widget API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
