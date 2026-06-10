import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// ─────────────────────────────────────────────────────────────────────
// /api/dashboard/mattress-attach — attach rate materacy przy łóżkach.
//
//   Nowy konfigurator dodaje materac jako OSOBNĄ pozycję zamówienia.
//   Liczymy: dla zamówień zawierających wybrane modele łóżek — ile z nich
//   ma w tym samym zamówieniu pozycję z product_category='materac'.
//
//   GET ?date_from&date_to&shop=mybed.pl|all&models=Łóżko+A,Łóżko+B
//     models puste → analizujemy wszystkie łóżka (i zwracamy listę modeli
//     do pickera, posortowaną po liczbie zamówień).
// ─────────────────────────────────────────────────────────────────────

const PAGE = 1000;

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const dateFrom = url.searchParams.get('date_from') || '2025-01-01';
    const dateTo = url.searchParams.get('date_to') || new Date().toISOString().split('T')[0];
    const shop = (url.searchParams.get('shop') || 'all').toLowerCase();
    const modelsParam = url.searchParams.get('models') || '';
    const selectedModels = modelsParam.split(',').map(s => s.trim()).filter(Boolean);

    const db = getSupabaseAdmin();

    // 1) Zamówienia w zakresie (paginowane — PostgREST cap 1000)
    const orderIds: string[] = [];
    let offset = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let q = db.from('fact_orders')
        .select('order_id')
        .gte('order_date', dateFrom)
        .lte('order_date', `${dateTo}T23:59:59`)
        .range(offset, offset + PAGE - 1);
      if (shop !== 'all') q = q.eq('source_shop', shop);
      const { data, error } = await q;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data || data.length === 0) break;
      orderIds.push(...data.map(r => String(r.order_id)));
      if (data.length < PAGE) break;
      offset += PAGE;
    }

    if (orderIds.length === 0) {
      return NextResponse.json({ totals: emptyTotals(), perModel: [], availableModels: [] });
    }

    // 2) Pozycje łóżek + materacy dla tych zamówień. Chunk po 500 order_ids,
    //    w środku range-pagination (zamówienie może mieć wiele pozycji).
    const bedItems: Array<{ order_id: string; product_name: string }> = [];
    const mattressOrders = new Set<string>();
    const CHUNK = 500;
    for (let i = 0; i < orderIds.length; i += CHUNK) {
      const chunk = orderIds.slice(i, i + CHUNK);
      let off = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await db.from('v_order_items')
          .select('order_id, product_name, product_category')
          .in('order_id', chunk)
          .in('product_category', ['łóżko', 'materac'])
          .range(off, off + PAGE - 1);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!data || data.length === 0) break;
        for (const r of data as Array<{ order_id: string; product_name: string | null; product_category: string | null }>) {
          const oid = String(r.order_id);
          if (r.product_category === 'materac') mattressOrders.add(oid);
          else if (r.product_category === 'łóżko' && r.product_name) {
            bedItems.push({ order_id: oid, product_name: r.product_name.trim() });
          }
        }
        if (data.length < PAGE) break;
        off += PAGE;
      }
    }

    // 3) Lista dostępnych modeli (do pickera) — wszystkie łóżka w zakresie,
    //    sortowane po liczbie zamówień malejąco.
    const ordersByModel = new Map<string, Set<string>>();
    for (const it of bedItems) {
      (ordersByModel.get(it.product_name) ?? ordersByModel.set(it.product_name, new Set()).get(it.product_name)!)
        .add(it.order_id);
    }
    const availableModels = [...ordersByModel.entries()]
      .map(([name, orders]) => ({ name, orders: orders.size }))
      .sort((a, b) => b.orders - a.orders);

    // 4) Analiza — wybrane modele (lub wszystkie gdy brak selekcji).
    const analyzeModels = selectedModels.length > 0
      ? selectedModels
      : availableModels.map(m => m.name);

    const perModel = analyzeModels
      .filter(name => ordersByModel.has(name))
      .map(name => {
        const orders = ordersByModel.get(name)!;
        let withMattress = 0;
        for (const oid of orders) if (mattressOrders.has(oid)) withMattress++;
        const total = orders.size;
        return {
          model: name,
          orders: total,
          withMattress,
          withoutMattress: total - withMattress,
          attachRate: total > 0 ? Math.round((withMattress / total) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.orders - a.orders);

    // Totals — po UNIKALNYCH zamówieniach (zamówienie z 2 modelami liczy się raz)
    const allSelectedOrders = new Set<string>();
    for (const name of analyzeModels) {
      const orders = ordersByModel.get(name);
      if (orders) for (const oid of orders) allSelectedOrders.add(oid);
    }
    let totWith = 0;
    for (const oid of allSelectedOrders) if (mattressOrders.has(oid)) totWith++;
    const totals = {
      orders: allSelectedOrders.size,
      withMattress: totWith,
      withoutMattress: allSelectedOrders.size - totWith,
      attachRate: allSelectedOrders.size > 0
        ? Math.round((totWith / allSelectedOrders.size) * 1000) / 10
        : 0,
    };

    return NextResponse.json({ totals, perModel, availableModels });
  } catch (err) {
    console.error('mattress-attach error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function emptyTotals() {
  return { orders: 0, withMattress: 0, withoutMattress: 0, attachRate: 0 };
}
