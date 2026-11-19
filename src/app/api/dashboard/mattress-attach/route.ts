import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { applyShopFilter } from '@/lib/shop-filter';

// ─────────────────────────────────────────────────────────────────────
// /api/dashboard/mattress-attach — attach rate materacy przy łóżkach.
//
//   DWA konfiguratory, dwa sygnały „z materacem":
//   - NOWY: materac jako OSOBNA pozycja zamówienia (category='materac').
//   - STARY: materac jako WARIANT łóżka — mattress_type na pozycji łóżka
//     ('materacvisco', 'materacclassic'... = z materacem;
//      'bezmateraca'/'ohnematratze'/'bez materaca'/null = bez).
//
//   Liczymy oba i raportujemy osobno — widać też który model już
//   przeszedł na nowy konfigurator (osobne pozycje > 0).
//
//   GET ?date_from&date_to&shop=mybed.pl|all&models=Łóżko+A,Łóżko+B
//     models puste → wszystkie łóżka.
// ─────────────────────────────────────────────────────────────────────

const PAGE = 1000;

// Wartości mattress_type oznaczające BRAK materaca w starym konfiguratorze.
const NO_MATTRESS_VARIANTS = new Set(['bezmateraca', 'ohnematratze', 'bez materaca', '']);
function variantHasMattress(mt: string | null | undefined): boolean {
  if (mt == null) return false;
  const norm = mt.trim().toLowerCase();
  return norm.length > 0 && !NO_MATTRESS_VARIANTS.has(norm);
}

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
      q = applyShopFilter(q, shop);
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
    const bedItems: Array<{ order_id: string; product_name: string; hasVariantMattress: boolean }> = [];
    const mattressOrders = new Set<string>();   // osobna pozycja (nowy konfigurator)
    const CHUNK = 500;
    for (let i = 0; i < orderIds.length; i += CHUNK) {
      const chunk = orderIds.slice(i, i + CHUNK);
      let off = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await db.from('v_order_items')
          .select('order_id, product_name, product_category, mattress_type')
          .in('order_id', chunk)
          .in('product_category', ['łóżko', 'materac'])
          .range(off, off + PAGE - 1);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        if (!data || data.length === 0) break;
        for (const r of data as Array<{ order_id: string; product_name: string | null; product_category: string | null; mattress_type: string | null }>) {
          const oid = String(r.order_id);
          if (r.product_category === 'materac') mattressOrders.add(oid);
          else if (r.product_category === 'łóżko' && r.product_name) {
            bedItems.push({
              order_id: oid,
              product_name: r.product_name.trim(),
              hasVariantMattress: variantHasMattress(r.mattress_type),
            });
          }
        }
        if (data.length < PAGE) break;
        off += PAGE;
      }
    }

    // 3) Agregacja per (model, zamówienie): zbiór zamówień + czy KTÓRAKOLWIEK
    //    pozycja tego modelu w zamówieniu miała wariant z materacem.
    const ordersByModel = new Map<string, Set<string>>();
    const variantByModelOrder = new Map<string, Set<string>>(); // model -> set order_id z wariantem
    for (const it of bedItems) {
      (ordersByModel.get(it.product_name) ?? ordersByModel.set(it.product_name, new Set()).get(it.product_name)!)
        .add(it.order_id);
      if (it.hasVariantMattress) {
        (variantByModelOrder.get(it.product_name) ?? variantByModelOrder.set(it.product_name, new Set()).get(it.product_name)!)
          .add(it.order_id);
      }
    }
    const availableModels = [...ordersByModel.entries()]
      .map(([name, orders]) => ({ name, orders: orders.size }))
      .sort((a, b) => b.orders - a.orders);

    // 4) Analiza — wybrane modele (lub wszystkie gdy brak selekcji).
    //    Klasyfikacja per zamówienie (precedencja: osobna pozycja > wariant > bez):
    //    - withItem:    osobna pozycja materaca w zamówieniu (nowy konfigurator)
    //    - withVariant: pozycja łóżka miała mattress_type z materacem (stary)
    //    - without:     żadne z powyższych
    const analyzeModels = selectedModels.length > 0
      ? selectedModels
      : availableModels.map(m => m.name);

    function classify(name: string, oid: string): 'item' | 'variant' | 'none' {
      if (mattressOrders.has(oid)) return 'item';
      if (variantByModelOrder.get(name)?.has(oid)) return 'variant';
      return 'none';
    }

    const perModel = analyzeModels
      .filter(name => ordersByModel.has(name))
      .map(name => {
        const orders = ordersByModel.get(name)!;
        let withItem = 0, withVariant = 0;
        for (const oid of orders) {
          const c = classify(name, oid);
          if (c === 'item') withItem++;
          else if (c === 'variant') withVariant++;
        }
        const total = orders.size;
        const withAny = withItem + withVariant;
        return {
          model: name,
          orders: total,
          withMattressItem: withItem,
          withMattressVariant: withVariant,
          withoutMattress: total - withAny,
          attachRate: total > 0 ? Math.round((withAny / total) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.orders - a.orders);

    // Totals — po UNIKALNYCH zamówieniach. Wariant per zamówienie = czy
    // którykolwiek z analizowanych modeli w tym zamówieniu miał wariant.
    const allSelectedOrders = new Set<string>();
    for (const name of analyzeModels) {
      const orders = ordersByModel.get(name);
      if (orders) for (const oid of orders) allSelectedOrders.add(oid);
    }
    let totItem = 0, totVariant = 0;
    for (const oid of allSelectedOrders) {
      if (mattressOrders.has(oid)) { totItem++; continue; }
      const hasVariant = analyzeModels.some(name => variantByModelOrder.get(name)?.has(oid));
      if (hasVariant) totVariant++;
    }
    const totAny = totItem + totVariant;
    const totals = {
      orders: allSelectedOrders.size,
      withMattressItem: totItem,
      withMattressVariant: totVariant,
      withoutMattress: allSelectedOrders.size - totAny,
      attachRate: allSelectedOrders.size > 0
        ? Math.round((totAny / allSelectedOrders.size) * 1000) / 10
        : 0,
    };

    return NextResponse.json({ totals, perModel, availableModels });
  } catch (err) {
    console.error('mattress-attach error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function emptyTotals() {
  return { orders: 0, withMattressItem: 0, withMattressVariant: 0, withoutMattress: 0, attachRate: 0 };
}
