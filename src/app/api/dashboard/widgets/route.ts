import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { isInWarsawDateRange, shiftDate, warsawDateKey } from '@/lib/warsaw-date';
import { fetchEurRatesByDate, gaToPln } from '@/lib/ad-cost';

export async function POST(request: NextRequest) {
  try {
    const { widget, dateFrom, dateTo, shop = 'all', limit = 20, crossFilters: rawCrossFilters = [] } = await request.json();
    const db = getSupabaseAdmin();
    const fetchFrom = shiftDate(dateFrom, -1);
    const fetchTo = shiftDate(dateTo, 1);
    const CANCELLED_STATUS = 'anulowane';

    const EUR_SHOPS = ['mybed.de', 'amazon.de', 'kaufland.de'];
    const isEurShop = shop !== 'all' && EUR_SHOPS.includes(shop);
    const currency = isEurShop ? 'EUR' : 'PLN';

    const orderCrossFields = ['supplier', 'delivery_city', 'coupon_code', 'source_shop'];
    const itemCrossFields = ['product_name', 'product_category', 'fabric', 'fabric_collection', 'bed_size', 'mattress_type', 'headboard_height', 'storage_type'];

    // Widget NIE filtruje sam siebie: gdy ranking_models jest źródłem cross-filtru
    // `product_name`, ten widget musi widzieć WSZYSTKIE modele żeby user mógł
    // wybrać kolejny. Inaczej po pierwszym kliku tabela zwija się do 1 wiersza
    // i nie da się zaznaczyć drugiego.
    const WIDGET_SOURCE_FIELD: Record<string, string> = {
      ranking_models: 'product_name',
      ranking_fabric_collections: 'fabric_collection',
      ranking_fabrics: 'fabric',
      ranking_cities: 'delivery_city',
      ranking_suppliers: 'supplier',
      ranking_coupons: 'coupon_code',
      ranking_bed_sizes: 'bed_size',
      ranking_headboard_heights: 'headboard_height',
      ranking_storage_types: 'storage_type',
    };
    const widgetSourceField = WIDGET_SOURCE_FIELD[widget];
    const crossFilters = widgetSourceField
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (rawCrossFilters as Array<{ field: string; value: string }>).filter((cf: any) => cf.field !== widgetSourceField)
      : rawCrossFilters;

    // Cross-filtry: grupuj po polu, w obrębie pola = OR (multi-select);
    // między polami = AND. Dla coupon_code ILIKE (case-insensitive — w bazie
    // np. „Merve7", w rankingu pokazywany jako „MERVE7").
    const ILIKE_FIELDS = new Set(['coupon_code']);
    function escapeIlike(s: string): string {
      return String(s).replace(/[\\%_,()]/g, m => `\\${m}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function applyCross(q: any, allowedFields: string[]): any {
      const byField: Record<string, string[]> = {};
      for (const cf of crossFilters) {
        if (!allowedFields.includes(cf.field)) continue;
        (byField[cf.field] ||= []).push(String(cf.value));
      }
      for (const [field, values] of Object.entries(byField)) {
        if (ILIKE_FIELDS.has(field)) {
          const ors = values.map(v => `${field}.ilike.${escapeIlike(v)}`).join(',');
          q = q.or(ors);
        } else if (values.length === 1) {
          q = q.eq(field, values[0]);
        } else {
          q = q.in(field, values);
        }
      }
      return q;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function orderQuery(select: string): any {
      const withDate = select.includes('order_date') ? select : `${select}, order_date`;
      let q = db.from('fact_orders').select(withDate)
        .gte('order_date', fetchFrom).lte('order_date', fetchTo + 'T23:59:59');
      if (shop !== 'all') q = q.eq('source_shop', shop);
      q = applyCross(q, orderCrossFields);
      return q;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function orderQueryAllStatuses(select: string): any {
      const withDate = select.includes('order_date') ? select : `${select}, order_date`;
      let q = db.from('fact_orders').select(withDate)
        .gte('order_date', fetchFrom).lte('order_date', fetchTo + 'T23:59:59');
      if (shop !== 'all') q = q.eq('source_shop', shop);
      q = applyCross(q, orderCrossFields);
      return q;
    }

    function scopeOrdersByWarsawDate<T extends { order_date?: string | null }>(
      rows: T[] | null | undefined,
    ): T[] {
      if (!rows?.length) return [];
      return rows.filter(r => isInWarsawDateRange(r.order_date, dateFrom, dateTo));
    }

    // ── SAFE items query: two-step approach (replaces broken iq() join) ──
    // Step 1: get order_ids from fact_orders with reliable date filter (cached)
    // Step 2: get items from fact_order_items filtered by those order_ids
    // NOTE: Supabase caps responses at 1000 rows — must paginate with .range()
    const PAGE = 1000;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function fetchAllRows(baseQuery: any): Promise<any[]> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out: any[] = [];
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

    let _validOrderIds: string[] | null = null;
    async function getValidOrderIds(): Promise<string[]> {
      if (_validOrderIds !== null) return _validOrderIds;

      function buildQ() {
        let q = db.from('fact_orders').select('order_id, order_date')
          .gte('order_date', fetchFrom).lte('order_date', fetchTo + 'T23:59:59');
        if (shop !== 'all') q = q.eq('source_shop', shop);
        q = applyCross(q, orderCrossFields);
        return q;
      }

      const allIds: string[] = [];
      let offset = 0;
      while (true) {
        const { data } = await buildQ().range(offset, offset + PAGE - 1);
        if (!data || data.length === 0) break;
        for (const r of data as Array<{ order_id: string; order_date?: string | null }>) {
          if (!isInWarsawDateRange(r.order_date, dateFrom, dateTo)) continue;
          allIds.push(r.order_id);
        }
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
          // v_order_items = fact_order_items + wyliczona flaga is_sample
          let q = db.from('v_order_items')
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

    function shopTokens(selectedShop: string): string[] {
      if (selectedShop === 'all') return [];
      const normalized = selectedShop.toLowerCase();
      // account_id Mety dla każdego sklepu — bez tego filtr sklepu na widgetach
      // Meta (kpi_meta_spend, kpi_mer, kpi_total_marketing_cost) zwracał 0,
      // bo nazwy kampanii często nie zawierają „mybed.de" itd., a samo account_id
      // jest jedynym pewnym powiązaniem z konkretnym kontem reklamowym.
      const map: Record<string, string[]> = {
        'mybed.pl': ['mybed.pl', 'mybed_pl', 'mybedpl', 'act_1681802382204753'],
        'mybed.de': ['mybed.de', 'mybed_de', 'mybedde', 'act_637792865917248'],
        'mittohome.pl': ['mittohome.pl', 'mittohome_pl', 'mittohomepl', 'act_797212915921530'],
        'showroom': ['showroom'],
        'amazon.de': ['amazon.de', 'amazon_de', 'amazonde'],
        'allegro.pl': ['allegro.pl', 'allegro_pl', 'allegropl'],
        'kaufland.de': ['kaufland.de', 'kaufland_de', 'kauflandde'],
      };
      return map[normalized] || [normalized];
    }

    function textContainsShop(value: unknown, selectedShop: string): boolean {
      if (selectedShop === 'all') return true;
      const text = String(value || '').toLowerCase();
      if (!text) return false;
      return shopTokens(selectedShop).some(t => text.includes(t));
    }

    function filterRowsByShopHint<T extends Record<string, unknown>>(rows: T[], selectedShop: string, fields: string[]): T[] {
      if (selectedShop === 'all') return rows;
      return rows.filter(r => fields.some(f => textContainsShop(r[f], selectedShop)));
    }

    async function getKpiTotals() {
      const grossField = isEurShop ? 'total_gross' : 'total_gross_pln';

      const filteredIds = await getFilteredOrderIds();
      let q = orderQuery(`${grossField}, total_gross_pln, is_paid, status`);
      if (filteredIds !== null) {
        if (filteredIds.length === 0) return init;
        q = q.in('order_id', filteredIds.slice(0, 5000));
      }
      const data = await fetchAllRows(q);
      const scoped = scopeOrdersByWarsawDate(data);
      const totals = scoped.reduce((a: typeof init, r: Record<string, unknown>) => ({
        revenue: a.revenue + ((r[grossField] as number) || (r.total_gross_pln as number) || 0),
        paid: a.paid + (r.is_paid ? ((r.total_gross_pln as number) || 0) : 0),
        orders: a.orders + 1,
        ordersPaid: a.ordersPaid + (r.is_paid ? 1 : 0),
        cancelled: a.cancelled,
      }), init);

      let cq = orderQueryAllStatuses('status');
      if (filteredIds !== null) {
        if (filteredIds.length === 0) return totals;
        cq = cq.in('order_id', filteredIds.slice(0, 5000));
      }
      const cancelledRows = await fetchAllRows(cq.eq('status', CANCELLED_STATUS));
      totals.cancelled = scopeOrdersByWarsawDate(cancelledRows).length;

      return totals;
    }

    switch (widget) {
      // ── KPI Cards ──
      case 'kpi_revenue':
      case 'kpi_revenue_paid':
      case 'kpi_revenue_unpaid':
      case 'kpi_orders':
      case 'kpi_orders_beds':
      case 'kpi_qty_beds':
      case 'kpi_qty_samples':
      case 'kpi_orders_samples':
      case 'kpi_aov':
      case 'kpi_payment_rate': {
        const totals = await getKpiTotals();
        const unpaid = totals.revenue - totals.paid;
        const aov = totals.orders > 0 ? totals.revenue / totals.orders : 0;
        const paymentRate = totals.orders > 0 ? (totals.ordersPaid / totals.orders) * 100 : 0;

        let bedOrders = 0, sampleOrders = 0, bedQty = 0, sampleQty = 0;

        if (widget === 'kpi_orders_beds' || widget === 'kpi_qty_beds') {
          // Łóżko = realny produkt (is_sample=false) w kategorii 'łóżko'.
          const items = await iqSafe('product_category, is_sample, quantity');
          const bedOrderIds = new Set<string>();
          for (const i of items) {
            if (!i.is_sample && String(i.product_category || '') === 'łóżko') {
              bedOrderIds.add(i.order_id);
              bedQty += (i.quantity || 1);
            }
          }
          bedOrders = bedOrderIds.size;
          Object.assign(debug, { query: widget === 'kpi_qty_beds' ? 'SUM(quantity)' : 'COUNT DISTINCT order_id', itemsFound: items.length, uniqueOrders: bedOrders, totalQty: bedQty, ordersInRange: (await getValidOrderIds()).length });
        }
        if (widget === 'kpi_orders_samples' || widget === 'kpi_qty_samples') {
          // Próbki = v_order_items.is_sample (flaga z migracji 011).
          const items = await iqSafe('is_sample, quantity');
          const sampleOrderIds = new Set<string>();
          for (const i of items) {
            if (i.is_sample) {
              sampleOrderIds.add(i.order_id);
              sampleQty += (i.quantity || 1);
            }
          }
          sampleOrders = sampleOrderIds.size;
          Object.assign(debug, { query: widget === 'kpi_qty_samples' ? 'SUM(quantity)' : 'COUNT DISTINCT order_id', itemsFound: items.length, uniqueOrders: sampleOrders, totalQty: sampleQty, ordersInRange: (await getValidOrderIds()).length });
        }

        const valueMap: Record<string, { value: number; format: string; debugQuery?: string }> = {
          kpi_revenue: { value: totals.revenue, format: 'currency', debugQuery: 'SUM(total_gross_pln) from fact_orders' },
          kpi_revenue_paid: { value: totals.paid, format: 'currency', debugQuery: 'SUM(total_gross_pln) for paid orders' },
          kpi_revenue_unpaid: { value: unpaid, format: 'currency', debugQuery: 'revenue - paid' },
          kpi_orders: { value: totals.orders, format: 'number', debugQuery: 'COUNT(*) from fact_orders' },
          kpi_orders_beds: { value: bedOrders, format: 'number', debugQuery: 'COUNT DISTINCT order_id WHERE is_sample=false AND product_category=łóżko' },
          kpi_qty_beds: { value: bedQty, format: 'number', debugQuery: 'SUM(quantity) WHERE is_sample=false AND product_category=łóżko' },
          kpi_orders_samples: { value: sampleOrders, format: 'number', debugQuery: 'COUNT DISTINCT order_id WHERE is_sample=true' },
          kpi_qty_samples: { value: sampleQty, format: 'number', debugQuery: 'SUM(quantity) WHERE is_sample=true' },
          kpi_aov: { value: aov, format: 'currency', debugQuery: 'revenue / orders' },
          kpi_payment_rate: { value: paymentRate, format: 'percent', debugQuery: 'ordersPaid / orders * 100' },
        };

        return NextResponse.json({ type: 'kpi', ...valueMap[widget], currency, debug: { ...debug, debugQuery: valueMap[widget].debugQuery } });
      }

      // ── Rankings ──
      case 'ranking_models': {
        // Realne produkty = v_order_items.is_sample = false (flaga z migracji 011
        // wyodrębnia próbki tkanin niezależnie od niespójnej kategoryzacji).
        const items = await iqSafe('product_name, item_type, is_sample, quantity');
        const map: Record<string, number> = {};
        const placeholderProductPattern = /produkt\s+indywidualny|individual\s+product|pozycja\s+indywidualna|niezidentyfikowany/i;
        for (const i of items) {
          const name = String(i.product_name || '').trim();
          if (!name) continue;
          if (i.is_sample) continue;
          if (String(i.item_type || '') !== 'product') continue;
          if (placeholderProductPattern.test(name)) continue;
          map[name] = (map[name] || 0) + (i.quantity || 1);
        }
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        const total = ranked.reduce((s,[,v]) => s + v, 0);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total, debug: { ...debug, query: 'v_order_items WHERE is_sample=false AND item_type=product, grouped by product_name, SUM(quantity)', itemsFound: items.length } });
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
        const data = await fetchAllRows(orderQuery('delivery_city').not('delivery_city', 'is', null));
        const scoped = scopeOrdersByWarsawDate(data);
        const map: Record<string, number> = {};
        for (const o of scoped) if (o.delivery_city) map[o.delivery_city] = (map[o.delivery_city] || 0) + 1;
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value })), total: ranked.reduce((s,[,v]) => s + v, 0), debug: { ...debug, query: 'COUNT grouped by delivery_city from fact_orders' } });
      }

      case 'ranking_suppliers': {
        const grossCol = isEurShop ? 'total_gross' : 'total_gross_pln';
        const data = await fetchAllRows(orderQuery(`supplier, ${grossCol}`).not('supplier', 'is', null));
        const scoped = scopeOrdersByWarsawDate(data);
        const map: Record<string, number> = {};
        for (const o of scoped) if (o.supplier) map[o.supplier] = (map[o.supplier] || 0) + (o[grossCol] || 0);
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value: Math.round(value) })), total: ranked.reduce((s,[,v]) => s + v, 0), format: 'currency', currency, debug: { ...debug, query: `SUM(${grossCol}) grouped by supplier` } });
      }

      case 'ranking_coupons': {
        const data = await fetchAllRows(orderQuery('coupon_code').not('coupon_code', 'is', null));
        const scoped = scopeOrdersByWarsawDate(data);
        const map: Record<string, number> = {};
        for (const o of scoped) if (o.coupon_code) { const c = o.coupon_code.trim().toUpperCase(); map[c] = (map[c] || 0) + 1; }
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
        const filteredIds = await getFilteredOrderIds();
        let q = orderQuery('order_date');
        if (filteredIds !== null) {
          if (filteredIds.length === 0) return NextResponse.json({ type: widget === 'chart_daily_orders' ? 'bar' : 'line', data: [], debug });
          q = q.in('order_id', filteredIds.slice(0, 5000));
        }
        const data = await fetchAllRows(q);
        const scoped = scopeOrdersByWarsawDate(data);
        const byDate: Record<string, number> = {};
        for (const r of scoped) {
          const d = warsawDateKey(r.order_date as string);
          if (!d) continue;
          byDate[d] = (byDate[d] || 0) + 1;
        }
        const chartData = Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b)).map(([name, value]) => ({ name, value }));
        return NextResponse.json({ type: widget === 'chart_daily_orders' ? 'bar' : 'line', data: chartData, debug });
      }

      case 'chart_revenue_timeline': {
        const filteredIds = await getFilteredOrderIds();
        let q = orderQuery('order_date, source_shop, total_gross_pln');
        if (filteredIds !== null) {
          if (filteredIds.length === 0) return NextResponse.json({ type: 'area', data: [], shops: [], debug });
          q = q.in('order_id', filteredIds.slice(0, 5000));
        }
        const data = await fetchAllRows(q);
        const scoped = scopeOrdersByWarsawDate(data);
        const shopSet = new Set<string>();
        const byDate: Record<string, Record<string, number>> = {};
        for (const r of scoped) {
          const d = warsawDateKey(r.order_date as string);
          if (!d) continue;
          if (!byDate[d]) byDate[d] = {};
          byDate[d][r.source_shop] = (byDate[d][r.source_shop] || 0) + (r.total_gross_pln || 0);
          shopSet.add(r.source_shop);
        }
        const shops = [...shopSet];
        const chartData = Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b))
          .map(([date, vals]) => ({ date, ...Object.fromEntries(shops.map(s => [s, Math.round(vals[s] || 0)])) }));
        return NextResponse.json({ type: 'area', data: chartData, shops, debug });
      }

      case 'chart_payment_status': {
        const filteredIds = await getFilteredOrderIds();
        let q = orderQuery('total_gross_pln, is_paid');
        if (filteredIds !== null) {
          if (filteredIds.length === 0) return NextResponse.json({ type: 'pie', data: [{ name: 'Zapłacone', value: 0 }, { name: 'Nieopłacone', value: 0 }], debug });
          q = q.in('order_id', filteredIds.slice(0, 5000));
        }
        const data = await fetchAllRows(q);
        const scoped = scopeOrdersByWarsawDate(data);
        let paid = 0, total = 0;
        for (const r of scoped) { total += (r.total_gross_pln || 0); if (r.is_paid) paid += (r.total_gross_pln || 0); }
        return NextResponse.json({ type: 'pie', data: [
          { name: 'Zapłacone', value: Math.round(paid) },
          { name: 'Nieopłacone', value: Math.round(total - paid) },
        ], debug });
      }

      case 'chart_suppliers': {
        const data = await fetchAllRows(orderQuery('supplier, total_gross_pln').not('supplier', 'is', null));
        const scoped = scopeOrdersByWarsawDate(data);
        const map: Record<string, number> = {};
        for (const o of scoped) if (o.supplier) map[o.supplier] = (map[o.supplier] || 0) + (o.total_gross_pln || 0);
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
        const filteredIds = await getFilteredOrderIds();
        let q = orderQuery('total_gross_pln, is_paid');
        if (filteredIds !== null) {
          if (filteredIds.length === 0) return NextResponse.json({ type: 'table', columns: ['Status', 'Zamówienia', 'Kwota'], data: [], debug });
          q = q.in('order_id', filteredIds.slice(0, 5000));
        }
        const data = await fetchAllRows(q);
        const scoped = scopeOrdersByWarsawDate(data);
        let paid = 0, unpaidRev = 0, paidCount = 0, unpaidCount = 0;
        for (const r of scoped) {
          const gross = r.total_gross_pln || 0;
          if (r.is_paid) {
            paid += gross;
            paidCount += 1;
          } else {
            unpaidRev += gross;
            unpaidCount += 1;
          }
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
        const q = db.from('fact_daily_traffic').select('sessions, users, transactions, hostname, campaign')
          .gte('date', dateFrom).lte('date', dateTo);
        const data = await fetchAllRows(q);
        const scopedTraffic = filterRowsByShopHint(data || [], shop, ['hostname', 'campaign']);
        let sessions = 0, users = 0, transactions = 0;
        for (const r of scopedTraffic) { sessions += r.sessions || 0; users += r.users || 0; transactions += r.transactions || 0; }
        const convRate = sessions > 0 ? (transactions / sessions) * 100 : 0;
        const valMap: Record<string, { value: number; format: string }> = {
          kpi_sessions: { value: sessions, format: 'number' },
          kpi_users: { value: users, format: 'number' },
          kpi_conversion_rate: { value: convRate, format: 'percent' },
        };
        return NextResponse.json({ type: 'kpi', ...valMap[widget], debug });
      }

      case 'ranking_traffic_sources': {
        const q = db.from('fact_daily_traffic').select('source, medium, sessions, hostname, campaign')
          .gte('date', dateFrom).lte('date', dateTo);
        const data = await fetchAllRows(q);
        const scopedTraffic = filterRowsByShopHint(data || [], shop, ['hostname', 'campaign']);
        const map: Record<string, number> = {};
        for (const r of scopedTraffic) {
          const key = `${r.source} / ${r.medium}`;
          map[key] = (map[key] || 0) + (r.sessions || 0);
        }
        const ranked = Object.entries(map).sort(([,a],[,b]) => b - a).slice(0, limit);
        return NextResponse.json({ type: 'ranking', data: ranked.map(([name, value]) => ({ name, value })), total: ranked.reduce((s,[,v]) => s + v, 0), debug });
      }

      case 'chart_sessions_timeline': {
        const q = db.from('fact_daily_traffic').select('date, hostname, sessions, campaign')
          .gte('date', dateFrom).lte('date', dateTo).order('date');
        const data = await fetchAllRows(q);
        const scopedTraffic = filterRowsByShopHint(data || [], shop, ['hostname', 'campaign']);
        const hostSet = new Set<string>();
        const byDate: Record<string, Record<string, number>> = {};
        for (const r of scopedTraffic) {
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
        const revData = await fetchAllRows(orderQuery('total_gross_pln'));
        const totalRevenue = scopeOrdersByWarsawDate(revData).reduce((s, r) => s + (r.total_gross_pln || 0), 0);

        const metaData = await fetchAllRows(
          db.from('fact_daily_adspend').select('spend, campaign_name, adset_name, account_id')
            .eq('platform', 'meta').gte('date', dateFrom).lte('date', dateTo)
        );
        const metaScoped = filterRowsByShopHint(metaData || [], shop, ['campaign_name', 'adset_name', 'account_id']);
        const metaSpend = metaScoped.reduce((s, r) => s + (r.spend || 0), 0);

        const googleData = await fetchAllRows(
          db.from('fact_daily_traffic').select('date, ad_cost, hostname, campaign, source')
            .eq('source', '__total__').gte('date', dateFrom).lte('date', dateTo)
        );
        const googleScoped = filterRowsByShopHint(googleData || [], shop, ['hostname', 'campaign', 'source']);
        // ad_cost dla mybed.de jest w EUR (waluta property GA4) — konwersja na PLN
        // przez kursy z fact_orders.exchange_rate.
        const eurRates = await fetchEurRatesByDate(db, dateFrom, dateTo);
        const googleSpend = googleScoped.reduce(
          (s, r) => s + gaToPln(r.hostname, Number(r.ad_cost) || 0, String(r.date), eurRates),
          0,
        );

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

      // ── Geo heatmap (PL+DE, normalizacja Warszawa/WARSZAWA/Warsaw) ──
      case 'geo_heatmap': {
        // Pobieramy dim_cities raz (~120 wpisów). Aliasy w pamięci — DB-side
        // OR przez funkcję immutable jest za wolny dla 41k zamówień.
        const { data: cities, error: cityErr } = await db
          .from('dim_cities')
          .select('slug, display_name, country, lat, lon, aliases');
        if (cityErr) return NextResponse.json({ error: cityErr.message }, { status: 500 });

        // Slug + alias lookup map.
        const lookup = new Map<string, { slug: string; name: string; country: string; lat: number; lon: number }>();
        for (const c of cities || []) {
          const entry = { slug: c.slug, name: c.display_name, country: c.country, lat: Number(c.lat), lon: Number(c.lon) };
          lookup.set(c.slug, entry);
          for (const a of (c.aliases as string[]) || []) lookup.set(a, entry);
        }

        // Ta sama logika co normalize_city() w SQL — utrzymujemy synchronicznie.
        function normalize(raw: string | null): string | null {
          if (raw == null) return null;
          let s = raw.trim().toLowerCase();
          if (s.length < 2 || ['test', 'brak', '-', 'n/a', 'xxx', 'aaa', '.', '..', '...'].includes(s)) return null;
          s = s.replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue');
          s = s.replace(/[ąćęłńóśźż]/g, ch => ({ ą:'a', ć:'c', ę:'e', ł:'l', ń:'n', ó:'o', ś:'s', ź:'z', ż:'z' })[ch] || ch);
          s = s.replace(/[^a-z0-9 \-]/g, '');
          s = s.replace(/\s+/g, ' ').trim();
          return s.length < 2 ? null : s;
        }

        const orders = await fetchAllRows(
          orderQuery('delivery_city, total_gross_pln, is_paid')
            .not('delivery_city', 'is', null)
        );
        const scoped = scopeOrdersByWarsawDate(orders);

        // Agreguj per miasto. Niedopasowane do dim_cities idą do `unmatched`.
        const perCity = new Map<string, { name: string; country: string; lat: number; lon: number; orders: number; revenue: number }>();
        let totalMatched = 0;
        let totalUnmatched = 0;
        for (const o of scoped) {
          const norm = normalize(o.delivery_city);
          const city = norm ? lookup.get(norm) : null;
          if (!city) { totalUnmatched++; continue; }
          totalMatched++;
          const existing = perCity.get(city.slug);
          const rev = Number(o.total_gross_pln) || 0;
          if (existing) {
            existing.orders += 1;
            existing.revenue += rev;
          } else {
            perCity.set(city.slug, { name: city.name, country: city.country, lat: city.lat, lon: city.lon, orders: 1, revenue: rev });
          }
        }

        const points = [...perCity.values()]
          .map(p => ({ ...p, revenue: Math.round(p.revenue) }))
          .sort((a, b) => b.orders - a.orders);

        return NextResponse.json({
          type: 'geo_heatmap',
          data: points,
          stats: {
            matched: totalMatched,
            unmatched: totalUnmatched,
            coverage: totalMatched + totalUnmatched > 0
              ? Math.round((totalMatched / (totalMatched + totalUnmatched)) * 1000) / 10
              : 0,
          },
          debug: { ...debug, query: 'aggregate by normalize_city(delivery_city) → dim_cities' },
        });
      }

      default:
        return NextResponse.json({ error: `Unknown widget: ${widget}` }, { status: 400 });
    }
  } catch (err) {
    console.error('Widget API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
