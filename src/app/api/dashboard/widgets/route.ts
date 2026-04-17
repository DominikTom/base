import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { widget, dateFrom, dateTo, shop = 'all', limit = 20, crossFilters = [] } = await request.json();
    const db = getSupabaseAdmin();

    const EUR_SHOPS = ['mybed.de', 'amazon.de', 'kaufland.de'];
    const isEurShop = shop !== 'all' && EUR_SHOPS.includes(shop);
    const currency = isEurShop ? 'EUR' : 'PLN';

    const orderCrossFields = ['supplier', 'delivery_city', 'coupon_code', 'source_shop'];
    const itemCrossFields = ['product_name', 'product_category', 'fabric', 'fabric_collection', 'bed_size', 'mattress_type', 'headboard_height', 'storage_type'];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function applyCross(q: any, allowedFields: string[]): any {
      for (const cf of crossFilters) {
        if (allowedFields.includes(cf.field)) q = q.eq(cf.field, cf.value);
      }
      return q;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function orderQuery(select: string): any {
      let q = db.from('fact_orders').select(select)
        .gte('order_date', dateFrom).lte('order_date', dateTo + 'T23:59:59')
        .neq('status', 'anulowane');
      if (shop !== 'all') q = q.eq('source_shop', shop);
      q = applyCross(q, orderCrossFields);
      return q;
    }

    // ── SAFE items query: two-step approach (replaces broken iq() join) ──
    // Step 1: get order_ids from fact_orders with reliable date filter (cached)
    // Step 2: get items from fact_order_items filtered by those order_ids
    // NOTE: Supabase caps responses at 1000 rows — must paginate with .range()
    const PAGE = 1000;

    let _validOrderIds: string[] | null = null;
    async function getValidOrderIds(): Promise<string[]> {
      if (_validOrderIds !== null) return _validOrderIds;

      function buildQ() {
        let q = db.from('fact_orders').select('order_id')
          .gte('order_date', dateFrom).lte('order_date', dateTo + 'T23:59:59')
          .neq('status', 'anulowane');
        if (shop !== 'all') q = q.eq('source_shop', shop);
        q = applyCross(q, orderCrossFields);
        return q;
      }

      const allIds: string[] = [];
      let offset = 0;
      while (true) {
        const { data } = await buildQ().range(offset, offset + PAGE - 1);
        if (!data || data.length === 0) break;
        for (const r of data) allIds.push((r as { order_id: string }).order_id);
        if (data.length < PAGE) break;
        offset += PAGE;
      }
      _validOrderIds = allIds;
      return _validOrderIds;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function iqSafe(select: string, extraFilters?: { eq?: Record<string, string>; notNull?: string[] }): Promise<any[]> {
      const validIds = await getValidOrderIds();
      if (validIds.length === 0) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allItems: any[] = [];
      const CHUNK = 500;
      for (let i = 0; i < validIds.length; i += CHUNK) {
        const chunk = validIds.slice(i, i + CHUNK);

        function buildItemQ() {
          let q = db.from('fact_order_items')
            .select(select + ', order_id')
            .in('order_id', chunk);
          if (extraFilters?.eq) {
            for (const [k, v] of Object.entries(extraFilters.eq)) q = q.eq(k, v);
          }
          if (extraFilters?.notNull) {
            for (const col of extraFilters.notNull) q = q.not(col, 'is', null);
          }
          q = applyCross(q, itemCrossFields);
          return q;
        }

        let offset = 0;
        while (true) {
          const { data } = await buildItemQ().range(offset, offset + PAGE - 1);
          if (!data || data.length === 0) break;
          allItems.push(...data);
          if (data.length < PAGE) break;
          offset += PAGE;
        }
      }
      return allItems;
    }

    // Debug metadata added to every response
    const debug = {
      dateFrom,
      dateTo,
      shop,
      crossFilters: crossFilters.map((cf: { field: string; value: string }) => `${cf.field}=${cf.value}`),
    };

    const hasItemCrossFilters = crossFilters.some((cf: { field: string }) => itemCrossFields.includes(cf.field));

    async function getFilteredOrderIds(): Promise<string[] | null> {
      if (!hasItemCrossFilters) return null;
      const items = await iqSafe('order_id');
      return [...new Set(items.map(r => r.order_id))];
    }

    const init = { revenue: 0, paid: 0, orders: 0, ordersPaid: 0, cancelled: 0 };

    async function getKpiTotals() {
      const revField = isEurShop ? 'revenue_gross_original' : 'revenue_gross_pln';
      const grossField = isEurShop ? 'total_gross' : 'total_gross_pln';

      if (!hasItemCrossFilters && crossFilters.length === 0) {
        let q = db.from('fact_daily_revenue').select('*')
          .gte('date', dateFrom).lte('date', dateTo);
        if (shop !== 'all') q = q.eq('source_shop', shop);
        const { data } = await q.limit(50000);
        return (data || []).reduce((a: typeof init, r: Record<string, number | null>) => ({
          revenue: a.revenue + (r[revField] || r.revenue_gross_pln || 0),
          paid: a.paid + (r.revenue_paid_pln || 0),
          orders: a.orders + (r.orders_count || 0),
          ordersPaid: a.ordersPaid + (r.orders_paid || 0),
          cancelled: a.cancelled + (r.orders_cancelled || 0),
        }), init);
      }

      const filteredIds = await getFilteredOrderIds();
      let q = orderQuery(`${grossField}, total_gross_pln, is_paid, status`);
      if (filteredIds !== null) {
        if (filteredIds.length === 0) return init;
        q = q.in('order_id', filteredIds.slice(0, 5000));
      }
      const { data } = await q.limit(50000);
      return (data || []).reduce((a: typeof init, r: Record<string, unknown>) => ({
        revenue: a.revenue + ((r[grossField] as number) || (r.total_gross_pln as number) || 0),
        paid: a.paid + (r.is_paid ? ((r.total_gross_pln as number) || 0) : 0),
        orders: a.orders + 1,
        ordersPaid: a.ordersPaid + (r.is_paid ? 1 : 0),
        cancelled: a.cancelled + (r.status === 'anulowane' ? 1 : 0),
      }), init);
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
        const totals = await getKpiTotals();
        const unpaid = totals.revenue - totals.paid;
        const aov = totals.orders > 0 ? totals.revenue / totals.orders : 0;
        const paymentRate = totals.orders > 0 ? (totals.ordersPaid / totals.orders) * 100 : 0;

        let bedOrders = 0, sampleOrders = 0;
        if (widget === 'kpi_orders_beds') {
          const items = await iqSafe('product_name');
          const bedPattern = /łóżko|łożko|bett|boxspring/i;
          const bedOrderIds = new Set<string>();
          for (const i of items) {
            if (bedPattern.test(i.product_name || '')) bedOrderIds.add(i.order_id);
          }
          bedOrders = bedOrderIds.size;
          Object.assign(debug, { query: 'COUNT DISTINCT order_id WHERE product_name contains łóżko/bett/boxspring', itemsFound: items.length, uniqueOrders: bedOrders, ordersInRange: (await getValidOrderIds()).length });
        }
        if (widget === 'kpi_orders_samples') {
          const items = await iqSafe('product_name, product_category');
          const samplePattern = /próbk|muster|sample/i;
          const sampleOrderIds = new Set<string>();
          for (const i of items) {
            if (i.product_category === 'próbki' || samplePattern.test(i.product_name || '')) sampleOrderIds.add(i.order_id);
          }
          sampleOrders = sampleOrderIds.size;
          Object.assign(debug, { query: 'COUNT DISTINCT order_id WHERE product_name contains próbk/muster/sample', itemsFound: items.length, uniqueOrders: sampleOrders, ordersInRange: (await getValidOrderIds()).length });
        }

        const valueMap: Record<string, { value: number; format: string; debugQuery?: string }> = {
          kpi_revenue: { value: totals.revenue, format: 'currency', debugQuery: 'SUM(revenue_gross_pln) from fact_daily_revenue' },
          kpi_revenue_paid: { value: totals.paid, format: 'currency', debugQuery: 'SUM(revenue_paid_pln) from fact_daily_revenue' },
          kpi_revenue_unpaid: { value: unpaid, format: 'currency', debugQuery: 'revenue - paid' },
          kpi_orders: { value: totals.orders, format: 'number', debugQuery: 'SUM(orders_count) from fact_daily_revenue' },
          kpi_orders_beds: { value: bedOrders, format: 'number', debugQuery: 'COUNT DISTINCT order_id WHERE product_name contains łóżko/bett/boxspring' },
          kpi_orders_samples: { value: sampleOrders, format: 'number', debugQuery: 'COUNT DISTINCT order_id WHERE product_name contains próbk/muster/sample' },
          kpi_aov: { value: aov, format: 'currency', debugQuery: 'revenue / orders' },
          kpi_payment_rate: { value: paymentRate, format: 'percent', debugQuery: 'ordersPaid / orders * 100' },
        };

        return NextResponse.json({ type: 'kpi', ...valueMap[widget], currency, debug: { ...debug, debugQuery: valueMap[widget].debugQuery } });
      }

      // ── Rankings ──
      case 'ranking_models': {
        const items = await iqSafe('product_name, quantity', { eq: { product_category: 'łóżko' } });
        const map: Record<string, number> = {};
        for (const i of items) map[i.product_name] = (map[i.product_name] || 0) + (i.quantity || 1);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        const total = ranked.reduce((s,[,v]) => s + v, 0);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total, debug: { ...debug, query: 'fact_order_items WHERE product_category=łóżko, grouped by product_name, SUM(quantity)', itemsFound: items.length } });
      }

      case 'ranking_fabric_collections': {
        const items = await iqSafe('fabric_collection, quantity', { notNull: ['fabric_collection'] });
        const map: Record<string, number> = {};
        for (const i of items) if (i.fabric_collection) map[i.fabric_collection] = (map[i.fabric_collection] || 0) + (i.quantity || 1);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        const total = ranked.reduce((s,[,v]) => s + v, 0);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total, debug: { ...debug, query: 'SUM(quantity) grouped by fabric_collection' } });
      }

      case 'ranking_fabrics': {
        const items = await iqSafe('fabric, quantity', { notNull: ['fabric'] });
        const map: Record<string, number> = {};
        for (const i of items) if (i.fabric) map[i.fabric] = (map[i.fabric] || 0) + (i.quantity || 1);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        const total = ranked.reduce((s,[,v]) => s + v, 0);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total, debug: { ...debug, query: 'SUM(quantity) grouped by fabric' } });
      }

      case 'ranking_cities': {
        const { data } = await orderQuery('delivery_city').not('delivery_city', 'is', null).limit(50000);
        const map: Record<string, number> = {};
        for (const o of data || []) if (o.delivery_city) map[o.delivery_city] = (map[o.delivery_city] || 0) + 1;
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value })), total: ranked.reduce((s,[,v]) => s + v, 0), debug: { ...debug, query: 'COUNT grouped by delivery_city from fact_orders' } });
      }

      case 'ranking_suppliers': {
        const grossCol = isEurShop ? 'total_gross' : 'total_gross_pln';
        const { data } = await orderQuery(`supplier, ${grossCol}`).not('supplier', 'is', null).limit(50000);
        const map: Record<string, number> = {};
        for (const o of data || []) if (o.supplier) map[o.supplier] = (map[o.supplier] || 0) + (o[grossCol] || 0);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total: ranked.reduce((s,[,v]) => s + v, 0), format: 'currency', currency, debug: { ...debug, query: `SUM(${grossCol}) grouped by supplier` } });
      }

      case 'ranking_coupons': {
        const { data } = await orderQuery('coupon_code').not('coupon_code', 'is', null).limit(50000);
        const map: Record<string, number> = {};
        for (const o of data || []) if (o.coupon_code) { const c = o.coupon_code.trim().toUpperCase(); map[c] = (map[c] || 0) + 1; }
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value })), total: ranked.reduce((s,[,v]) => s + v, 0), debug: { ...debug, query: 'COUNT grouped by coupon_code' } });
      }

      case 'ranking_bed_sizes': {
        const items = await iqSafe('bed_size, quantity', { notNull: ['bed_size'] });
        const map: Record<string, number> = {};
        for (const i of items) if (i.bed_size) map[i.bed_size] = (map[i.bed_size] || 0) + (i.quantity || 1);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total: ranked.reduce((s,[,v]) => s + v, 0), debug: { ...debug, query: 'SUM(quantity) grouped by bed_size' } });
      }

      case 'ranking_headboard_heights': {
        const items = await iqSafe('headboard_height, quantity', { notNull: ['headboard_height'] });
        const map: Record<string, number> = {};
        for (const i of items) if (i.headboard_height) map[i.headboard_height] = (map[i.headboard_height] || 0) + (i.quantity || 1);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total: ranked.reduce((s,[,v]) => s + v, 0), debug: { ...debug, query: 'SUM(quantity) grouped by headboard_height' } });
      }

      case 'ranking_storage_types': {
        const items = await iqSafe('storage_type, quantity', { notNull: ['storage_type'] });
        const map: Record<string, number> = {};
        for (const i of items) if (i.storage_type) map[i.storage_type] = (map[i.storage_type] || 0) + (i.quantity || 1);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total: ranked.reduce((s,[,v]) => s + v, 0), debug: { ...debug, query: 'SUM(quantity) grouped by storage_type' } });
      }

      // ── Charts ──
      case 'chart_orders_timeline':
      case 'chart_daily_orders': {
        let chartData: Array<{ name: string; value: number }>;
        if (hasItemCrossFilters || crossFilters.length > 0) {
          const filteredIds = await getFilteredOrderIds();
          let q = orderQuery('order_date');
          if (filteredIds !== null) {
            if (filteredIds.length === 0) return NextResponse.json({ type: widget === 'chart_daily_orders' ? 'bar' : 'line', data: [], debug });
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
        return NextResponse.json({ type: widget === 'chart_daily_orders' ? 'bar' : 'line', data: chartData, debug });
      }

      case 'chart_revenue_timeline': {
        if (hasItemCrossFilters || crossFilters.length > 0) {
          const filteredIds = await getFilteredOrderIds();
          let q = orderQuery('order_date, source_shop, total_gross_pln');
          if (filteredIds !== null) {
            if (filteredIds.length === 0) return NextResponse.json({ type: 'area', data: [], shops: [], debug });
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
          return NextResponse.json({ type: 'area', data: chartData, shops, debug });
        }
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
        return NextResponse.json({ type: 'area', data: chartData, shops, debug });
      }

      case 'chart_payment_status': {
        if (hasItemCrossFilters || crossFilters.length > 0) {
          const filteredIds = await getFilteredOrderIds();
          let q = orderQuery('total_gross_pln, is_paid');
          if (filteredIds !== null) {
            if (filteredIds.length === 0) return NextResponse.json({ type: 'pie', data: [{ name: 'Zapłacone', value: 0 }, { name: 'Nieopłacone', value: 0 }], debug });
            q = q.in('order_id', filteredIds.slice(0, 5000));
          }
          const { data } = await q.limit(50000);
          let paid = 0, total = 0;
          for (const r of data || []) { total += (r.total_gross_pln || 0); if (r.is_paid) paid += (r.total_gross_pln || 0); }
          return NextResponse.json({ type: 'pie', data: [{ name: 'Zapłacone', value: Math.round(paid) }, { name: 'Nieopłacone', value: Math.round(total - paid) }], debug });
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
        ], debug });
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
        return NextResponse.json({ type: 'pie', data: chartData, debug });
      }

      case 'chart_mattress_types': {
        const items = await iqSafe('mattress_type, quantity', { notNull: ['mattress_type'] });
        const map: Record<string, number> = {};
        for (const i of items) if (i.mattress_type) map[i.mattress_type] = (map[i.mattress_type] || 0) + (i.quantity || 1);
        const sorted = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, 10);
        return NextResponse.json({ type: 'pie', data: sorted.map(([name, value]) => ({ name, value: Math.round(value) })), debug });
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
        ], debug });
      }

      // ── GA4 / Traffic ──
      case 'kpi_sessions':
      case 'kpi_users':
      case 'kpi_conversion_rate': {
        const q = db.from('fact_daily_traffic').select('sessions, users, transactions')
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
        return NextResponse.json({ type: 'kpi', ...valMap[widget], debug });
      }

      case 'ranking_traffic_sources': {
        const q = db.from('fact_daily_traffic').select('source, medium, sessions')
          .gte('date', dateFrom).lte('date', dateTo);
        const { data } = await q.limit(50000);
        const map: Record<string, number> = {};
        for (const r of data || []) {
          const key = `${r.source} / ${r.medium}`;
          map[key] = (map[key] || 0) + (r.sessions || 0);
        }
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value })), total: ranked.reduce((s,[,v]) => s + v, 0), debug });
      }

      case 'chart_sessions_timeline': {
        const q = db.from('fact_daily_traffic').select('date, hostname, sessions')
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
        return NextResponse.json({ type: 'area', data: chartData, shops, debug });
      }

      // ── Marketing Efficiency (MER) ──
      case 'kpi_mer':
      case 'kpi_total_marketing_cost':
      case 'kpi_meta_spend':
      case 'kpi_google_spend': {
        let revQ = db.from('fact_daily_revenue').select('revenue_gross_pln')
          .gte('date', dateFrom).lte('date', dateTo);
        if (shop !== 'all') revQ = revQ.eq('source_shop', shop);
        const { data: revData } = await revQ.limit(50000);
        const totalRevenue = (revData || []).reduce((s, r) => s + (r.revenue_gross_pln || 0), 0);

        const { data: metaData } = await db.from('fact_daily_adspend').select('spend')
          .eq('platform', 'meta').gte('date', dateFrom).lte('date', dateTo).limit(50000);
        const metaSpend = (metaData || []).reduce((s, r) => s + (r.spend || 0), 0);

        const { data: googleData } = await db.from('fact_daily_traffic').select('ad_cost')
          .eq('source', '__total__').gte('date', dateFrom).lte('date', dateTo).limit(50000);
        const googleSpend = (googleData || []).reduce((s, r) => s + (r.ad_cost || 0), 0);

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
        if (widget === 'kpi_mer') {
          return NextResponse.json({ type: 'kpi', value: valMap[widget].value, format: 'mer', debug: { ...debug, query: 'revenue / (meta + google + agency)' } });
        }
        return NextResponse.json({ type: 'kpi', ...valMap[widget], debug });
      }

      default:
        return NextResponse.json({ error: `Unknown widget: ${widget}` }, { status: 400 });
    }
  } catch (err) {
    console.error('Widget API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
