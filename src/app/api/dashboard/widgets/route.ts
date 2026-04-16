import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { widget, dateFrom, dateTo, shop = 'all', limit = 20, crossFilters = [] } = await request.json();
    const db = getSupabaseAdmin();

    // Cross-filter fields that apply to fact_orders
    const orderCrossFields = ['supplier', 'delivery_city', 'coupon_code', 'source_shop'];
    // Cross-filter fields that apply to fact_order_items
    const itemCrossFields = ['product_name', 'product_category', 'fabric', 'fabric_collection', 'bed_size', 'mattress_type', 'headboard_height', 'storage_type'];

    // Helper: apply cross-filters to a query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function applyCross(q: any, allowedFields: string[]): any {
      for (const cf of crossFilters) {
        if (allowedFields.includes(cf.field)) {
          q = q.eq(cf.field, cf.value);
        }
      }
      return q;
    }

    // Helper: get cross-filtered order IDs (for filtering items by order-level cross filters)
    async function getCrossFilteredOrderIds(): Promise<string[] | null> {
      const orderLevelFilters = crossFilters.filter((cf: { field: string }) => orderCrossFields.includes(cf.field));
      if (orderLevelFilters.length === 0) return null;
      let q = db.from('fact_orders').select('order_id')
        .gte('order_date', dateFrom).lte('order_date', dateTo + 'T23:59:59');
      if (shop !== 'all') q = q.eq('source_shop', shop);
      q = applyCross(q, orderCrossFields);
      const { data } = await q.limit(50000);
      return data ? data.map((r: { order_id: string }) => r.order_id) : null;
    }

    // Helper: build order date filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function orderQuery(select: string): any {
      let q = db.from('fact_orders').select(select)
        .gte('order_date', dateFrom).lte('order_date', dateTo + 'T23:59:59');
      if (shop !== 'all') q = q.eq('source_shop', shop);
      q = applyCross(q, orderCrossFields);
      return q;
    }

    // Helper: build items query with join + cross-filters
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function iq(select: string): any {
      let q = db.from('fact_order_items')
        .select(select + ', order_id, fact_orders!inner(order_date, source_shop, supplier)')
        .gte('fact_orders.order_date', dateFrom)
        .lte('fact_orders.order_date', dateTo + 'T23:59:59')
        .neq('fact_orders.status', 'anulowane');
      if (shop !== 'all') q = q.eq('fact_orders.source_shop', shop);
      q = applyCross(q, itemCrossFields);
      for (const cf of crossFilters) {
        if (orderCrossFields.includes(cf.field)) {
          q = q.eq('fact_orders.' + cf.field, cf.value);
        }
      }
      return q;
    }

    // Check if any cross-filters are item-level (need to query orders via items)
    const hasItemCrossFilters = crossFilters.some((cf: { field: string }) => itemCrossFields.includes(cf.field));

    // Helper: get filtered order IDs when item-level cross-filters are active
    async function getFilteredOrderIds(): Promise<string[] | null> {
      if (!hasItemCrossFilters) return null;
      // Query items with cross-filters to get matching order_ids
      const { data } = await iq('order_id').limit(50000);
      if (!data) return [];
      return [...new Set((data as Array<{ order_id: string }>).map(r => r.order_id))];
    }

    // Helper: get KPI totals — uses fact_daily_revenue when no cross-filters,
    // otherwise queries fact_orders directly with filtered order_ids
    async function getKpiTotals() {
      if (!hasItemCrossFilters && crossFilters.length === 0) {
        // Fast path: use pre-aggregated table
        let q = db.from('fact_daily_revenue').select('*')
          .gte('date', dateFrom).lte('date', dateTo);
        if (shop !== 'all') q = q.eq('source_shop', shop);
        const { data } = await q.limit(50000);
        const rows = data || [];
        return rows.reduce((a: typeof init, r: Record<string, number | null>) => ({
          revenue: a.revenue + (r.revenue_gross_pln || 0),
          paid: a.paid + (r.revenue_paid_pln || 0),
          orders: a.orders + (r.orders_count || 0),
          ordersPaid: a.ordersPaid + (r.orders_paid || 0),
          cancelled: a.cancelled + (r.orders_cancelled || 0),
        }), init);
      }

      // Slow path: query fact_orders with cross-filters
      const filteredIds = await getFilteredOrderIds();
      let q = orderQuery('total_gross_pln, is_paid, status');
      if (filteredIds !== null) {
        if (filteredIds.length === 0) return init;
        // Supabase .in() has a limit, chunk if needed
        q = q.in('order_id', filteredIds.slice(0, 5000));
      }
      const { data } = await q.limit(50000);
      return (data || []).reduce((a: typeof init, r: Record<string, unknown>) => ({
        revenue: a.revenue + ((r.total_gross_pln as number) || 0),
        paid: a.paid + (r.is_paid ? ((r.total_gross_pln as number) || 0) : 0),
        orders: a.orders + 1,
        ordersPaid: a.ordersPaid + (r.is_paid ? 1 : 0),
        cancelled: a.cancelled + (r.status === 'anulowane' ? 1 : 0),
      }), init);
    }

    const init = { revenue: 0, paid: 0, orders: 0, ordersPaid: 0, cancelled: 0 };

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
        const totals = await getKpiTotals();

        const unpaid = totals.revenue - totals.paid;
        const aov = totals.orders > 0 ? totals.revenue / totals.orders : 0;
        const paymentRate = totals.orders > 0 ? (totals.ordersPaid / totals.orders) * 100 : 0;

        // For bed/sample counts, query items
        let bedOrders = 0, sampleOrders = 0;
        if (widget === 'kpi_orders_beds' || widget === 'kpi_orders_samples') {
          const { data: items } = await iq('order_id, product_category').limit(50000);
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
        const { data } = await iq('product_name, quantity')
          .eq('product_category', 'łóżko')
          .limit(50000);
        const map: Record<string, number> = {};
        for (const i of data || []) map[i.product_name] = (map[i.product_name] || 0) + (i.quantity || 1);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        const total = ranked.reduce((s,[,v]) => s + v, 0);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total });
      }

      case 'ranking_fabric_collections': {
        const { data } = await iq('fabric_collection, quantity')
          .not('fabric_collection', 'is', null)
          .limit(50000);
        const map: Record<string, number> = {};
        for (const i of data || []) if (i.fabric_collection) map[i.fabric_collection] = (map[i.fabric_collection] || 0) + (i.quantity || 1);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        const total = ranked.reduce((s,[,v]) => s + v, 0);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total });
      }

      case 'ranking_fabrics': {
        const { data } = await iq('fabric, quantity')
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
        const { data } = await iq('bed_size, quantity').not('bed_size', 'is', null).limit(50000);
        const map: Record<string, number> = {};
        for (const i of data || []) if (i.bed_size) map[i.bed_size] = (map[i.bed_size] || 0) + (i.quantity || 1);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total: ranked.reduce((s,[,v]) => s + v, 0) });
      }

      case 'ranking_headboard_heights': {
        const { data } = await iq('headboard_height, quantity').not('headboard_height', 'is', null).limit(50000);
        const map: Record<string, number> = {};
        for (const i of data || []) if (i.headboard_height) map[i.headboard_height] = (map[i.headboard_height] || 0) + (i.quantity || 1);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total: ranked.reduce((s,[,v]) => s + v, 0) });
      }

      case 'ranking_storage_types': {
        const { data } = await iq('storage_type, quantity').not('storage_type', 'is', null).limit(50000);
        const map: Record<string, number> = {};
        for (const i of data || []) if (i.storage_type) map[i.storage_type] = (map[i.storage_type] || 0) + (i.quantity || 1);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total: ranked.reduce((s,[,v]) => s + v, 0) });
      }

      // ── Charts ──
      case 'chart_orders_timeline':
      case 'chart_daily_orders': {
        let chartData: Array<{ name: string; value: number }>;
        if (hasItemCrossFilters || crossFilters.length > 0) {
          // Use fact_orders with cross-filters
          const filteredIds = await getFilteredOrderIds();
          let q = orderQuery('order_date');
          if (filteredIds !== null) {
            if (filteredIds.length === 0) return NextResponse.json({ type: widget === 'chart_daily_orders' ? 'bar' : 'line', data: [] });
            q = q.in('order_id', filteredIds.slice(0, 5000));
          }
          const { data } = await q.limit(50000);
          const byDate: Record<string, number> = {};
          for (const r of data || []) { const d = (r.order_date as string).substring(0, 10); byDate[d] = (byDate[d] || 0) + 1; }
          chartData = Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b)).map(([name, value]) => ({ name, value }));
        } else {
          let q = db.from('fact_daily_revenue').select('date, orders_count')
            .gte('date', dateFrom).lte('date', dateTo).order('date');
          if (shop !== 'all') q = q.eq('source_shop', shop);
          const { data } = await q.limit(50000);
          const byDate: Record<string, number> = {};
          for (const r of data || []) byDate[r.date] = (byDate[r.date] || 0) + (r.orders_count || 0);
          chartData = Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b)).map(([name, value]) => ({ name, value }));
        }
        return NextResponse.json({ type: widget === 'chart_daily_orders' ? 'bar' : 'line', data: chartData });
      }

      case 'chart_revenue_timeline': {
        if (hasItemCrossFilters || crossFilters.length > 0) {
          const filteredIds = await getFilteredOrderIds();
          let q = orderQuery('order_date, source_shop, total_gross_pln');
          if (filteredIds !== null) {
            if (filteredIds.length === 0) return NextResponse.json({ type: 'area', data: [], shops: [] });
            q = q.in('order_id', filteredIds.slice(0, 5000));
          }
          const { data } = await q.limit(50000);
          const shopSet = new Set<string>();
          const byDate: Record<string, Record<string, number>> = {};
          for (const r of data || []) {
            const d = (r.order_date as string).substring(0, 10);
            if (!byDate[d]) byDate[d] = {};
            byDate[d][r.source_shop] = (byDate[d][r.source_shop] || 0) + (r.total_gross_pln || 0);
            shopSet.add(r.source_shop);
          }
          const shops = [...shopSet];
          const chartData = Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b))
            .map(([date, vals]) => ({ date, ...Object.fromEntries(shops.map(s => [s, Math.round(vals[s] || 0)])) }));
          return NextResponse.json({ type: 'area', data: chartData, shops });
        }
        // Fast path: pre-aggregated
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
        if (hasItemCrossFilters || crossFilters.length > 0) {
          const filteredIds = await getFilteredOrderIds();
          let q = orderQuery('total_gross_pln, is_paid');
          if (filteredIds !== null) {
            if (filteredIds.length === 0) return NextResponse.json({ type: 'pie', data: [{ name: 'Zapłacone', value: 0 }, { name: 'Nieopłacone', value: 0 }] });
            q = q.in('order_id', filteredIds.slice(0, 5000));
          }
          const { data } = await q.limit(50000);
          let paid = 0, total = 0;
          for (const r of data || []) { total += (r.total_gross_pln || 0); if (r.is_paid) paid += (r.total_gross_pln || 0); }
          return NextResponse.json({ type: 'pie', data: [{ name: 'Zapłacone', value: Math.round(paid) }, { name: 'Nieopłacone', value: Math.round(total - paid) }] });
        }
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
        const { data } = await iq('mattress_type, quantity').not('mattress_type', 'is', null).limit(50000);
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

      // ── GA4 / Traffic ──
      case 'kpi_sessions':
      case 'kpi_users':
      case 'kpi_conversion_rate': {
        let q = db.from('fact_daily_traffic').select('sessions, users, transactions')
          .gte('date', dateFrom).lte('date', dateTo);
        const { data } = await q.limit(50000);
        let sessions = 0, users = 0, transactions = 0;
        for (const r of data || []) { sessions += r.sessions || 0; users += r.users || 0; transactions += r.transactions || 0; }
        const convRate = sessions > 0 ? (transactions / sessions) * 100 : 0;
        const valMap: Record<string, { value: number; format: string }> = {
          kpi_sessions: { value: sessions, format: 'number' },
          kpi_users: { value: users, format: 'number' },
          kpi_conversion_rate: { value: convRate, format: 'percent' },
        };
        return NextResponse.json({ type: 'kpi', ...valMap[widget] });
      }

      case 'ranking_traffic_sources': {
        let q = db.from('fact_daily_traffic').select('source, medium, sessions')
          .gte('date', dateFrom).lte('date', dateTo);
        const { data } = await q.limit(50000);
        const map: Record<string, number> = {};
        for (const r of data || []) {
          const key = `${r.source} / ${r.medium}`;
          map[key] = (map[key] || 0) + (r.sessions || 0);
        }
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value })), total: ranked.reduce((s,[,v]) => s + v, 0) });
      }

      case 'chart_sessions_timeline': {
        let q = db.from('fact_daily_traffic').select('date, hostname, sessions')
          .gte('date', dateFrom).lte('date', dateTo).order('date');
        const { data } = await q.limit(50000);
        const hostSet = new Set<string>();
        const byDate: Record<string, Record<string, number>> = {};
        for (const r of data || []) {
          if (!byDate[r.date]) byDate[r.date] = {};
          byDate[r.date][r.hostname] = (byDate[r.date][r.hostname] || 0) + (r.sessions || 0);
          hostSet.add(r.hostname);
        }
        const shops = [...hostSet];
        const chartData = Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b))
          .map(([date, vals]) => ({ date, ...Object.fromEntries(shops.map(s => [s, vals[s] || 0])) }));
        return NextResponse.json({ type: 'area', data: chartData, shops });
      }

      // ── Marketing Efficiency (MER) ──
      case 'kpi_mer':
      case 'kpi_total_marketing_cost':
      case 'kpi_meta_spend':
      case 'kpi_google_spend': {
        // Revenue from ERP
        let revQ = db.from('fact_daily_revenue').select('revenue_gross_pln')
          .gte('date', dateFrom).lte('date', dateTo);
        if (shop !== 'all') revQ = revQ.eq('source_shop', shop);
        const { data: revData } = await revQ.limit(50000);
        const totalRevenue = (revData || []).reduce((s, r) => s + (r.revenue_gross_pln || 0), 0);

        // Meta spend
        const { data: metaData } = await db.from('fact_daily_adspend').select('spend')
          .eq('platform', 'meta').gte('date', dateFrom).lte('date', dateTo).limit(50000);
        const metaSpend = (metaData || []).reduce((s, r) => s + (r.spend || 0), 0);

        // Google Ads spend (from GA4 __total__ rows)
        const { data: googleData } = await db.from('fact_daily_traffic').select('ad_cost')
          .eq('source', '__total__').gte('date', dateFrom).lte('date', dateTo).limit(50000);
        const googleSpend = (googleData || []).reduce((s, r) => s + (r.ad_cost || 0), 0);

        // Agency costs (prorated: monthly costs split into the selected date range)
        const { data: agencyData } = await db.from('fact_agency_costs').select('month, amount_pln').limit(500);
        let agencyCost = 0;
        const dfrom = new Date(dateFrom);
        const dto = new Date(dateTo);
        for (const a of agencyData || []) {
          const m = new Date(a.month);
          const mEnd = new Date(m.getFullYear(), m.getMonth() + 1, 0);
          if (mEnd >= dfrom && m <= dto) agencyCost += a.amount_pln || 0;
        }

        const totalSpend = metaSpend + googleSpend + agencyCost;
        const mer = totalSpend > 0 ? totalRevenue / totalSpend : 0;

        const valMap: Record<string, { value: number; format: string }> = {
          kpi_mer: { value: Math.round(mer * 100) / 100, format: 'number' },
          kpi_total_marketing_cost: { value: Math.round(totalSpend), format: 'currency' },
          kpi_meta_spend: { value: Math.round(metaSpend), format: 'currency' },
          kpi_google_spend: { value: Math.round(googleSpend), format: 'currency' },
        };
        // Add 'x' suffix for MER display
        if (widget === 'kpi_mer') {
          return NextResponse.json({ type: 'kpi', value: valMap[widget].value, format: 'mer' });
        }
        return NextResponse.json({ type: 'kpi', ...valMap[widget] });
      }

      default:
        return NextResponse.json({ error: `Unknown widget: ${widget}` }, { status: 400 });
    }
  } catch (err) {
    console.error('Widget API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
