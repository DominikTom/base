import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from') || '2025-01-01';
    const dateTo = searchParams.get('date_to') || new Date().toISOString().split('T')[0];
    const shop = searchParams.get('shop') || 'all';

    // Fetch product items with order data
    let query = getSupabaseAdmin()
      .from('fact_order_items')
      .select('product_name, product_category, quantity, fabric, fabric_collection, bed_size, mattress_type, headboard_height, order_id, fact_orders!inner(order_date, source_shop, total_gross_pln, status)')
      .gte('fact_orders.order_date', dateFrom)
      .lte('fact_orders.order_date', dateTo + 'T23:59:59')
      .neq('fact_orders.status', 'anulowane');

    if (shop !== 'all') {
      query = query.eq('fact_orders.source_shop', shop);
    }

    const { data: items, error } = await query.limit(50000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Filter out non-products
    const productItems = (items || []).filter(i =>
      !['wysyłka', 'usługa', 'dopłata'].includes(i.product_category)
    );

    // Top products by quantity
    const productMap: Record<string, { qty: number; orders: Set<string>; category: string }> = {};
    for (const item of productItems) {
      if (!productMap[item.product_name]) {
        productMap[item.product_name] = { qty: 0, orders: new Set(), category: item.product_category };
      }
      productMap[item.product_name].qty += item.quantity || 1;
      productMap[item.product_name].orders.add(item.order_id);
    }

    const topByQuantity = Object.entries(productMap)
      .sort(([, a], [, b]) => b.qty - a.qty)
      .slice(0, 20)
      .map(([name, v]) => ({ name, value: Math.round(v.qty), orderCount: v.orders.size, category: v.category }));

    const topByOrders = Object.entries(productMap)
      .sort(([, a], [, b]) => b.orders.size - a.orders.size)
      .slice(0, 20)
      .map(([name, v]) => ({ name, value: v.orders.size, quantity: Math.round(v.qty), category: v.category }));

    // Fabric popularity
    const fabricMap: Record<string, number> = {};
    for (const item of productItems) {
      if (item.fabric_collection) {
        fabricMap[item.fabric_collection] = (fabricMap[item.fabric_collection] || 0) + (item.quantity || 1);
      }
    }
    const fabricChart = Object.entries(fabricMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, value]) => ({ name, value: Math.round(value) }));

    // Bed size distribution
    const sizeMap: Record<string, number> = {};
    for (const item of productItems) {
      if (item.bed_size) {
        sizeMap[item.bed_size] = (sizeMap[item.bed_size] || 0) + (item.quantity || 1);
      }
    }
    const sizeChart = Object.entries(sizeMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, value]) => ({ name, value: Math.round(value) }));

    // Mattress type distribution
    const mattressMap: Record<string, number> = {};
    for (const item of productItems) {
      if (item.mattress_type) {
        mattressMap[item.mattress_type] = (mattressMap[item.mattress_type] || 0) + (item.quantity || 1);
      }
    }
    const mattressChart = Object.entries(mattressMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, value]) => ({ name, value: Math.round(value) }));

    // Headboard height distribution
    const headboardMap: Record<string, number> = {};
    for (const item of productItems) {
      if (item.headboard_height) {
        headboardMap[item.headboard_height] = (headboardMap[item.headboard_height] || 0) + (item.quantity || 1);
      }
    }
    const headboardChart = Object.entries(headboardMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([name, value]) => ({ name, value: Math.round(value) }));

    // Category breakdown
    const categoryMap: Record<string, number> = {};
    for (const item of productItems) {
      categoryMap[item.product_category] = (categoryMap[item.product_category] || 0) + (item.quantity || 1);
    }
    const categoryChart = Object.entries(categoryMap)
      .sort(([, a], [, b]) => b - a)
      .map(([name, value]) => ({ name, value: Math.round(value) }));

    return NextResponse.json({
      topByQuantity,
      topByOrders,
      fabricChart,
      sizeChart,
      mattressChart,
      headboardChart,
      categoryChart,
      totalProducts: Object.keys(productMap).length,
    });
  } catch (err) {
    console.error('Products API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
