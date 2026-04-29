import { NextResponse } from 'next/server';

const schema = {
  dimensions: [
    { field: 'date', label: 'Data', type: 'date', table: 'fact_orders', operators: ['eq', 'between', 'gte', 'lte'] },
    { field: 'source_shop', label: 'Sklep', type: 'string', table: 'fact_orders', operators: ['eq', 'neq', 'in', 'contains'] },
    { field: 'source_platform', label: 'Platforma', type: 'string', table: 'fact_orders', operators: ['eq', 'neq', 'in'] },
    { field: 'supplier', label: 'Dostawca', type: 'string', table: 'fact_orders', operators: ['eq', 'neq', 'contains', 'in'] },
    { field: 'status', label: 'Status', type: 'string', table: 'fact_orders', operators: ['eq', 'neq', 'in'] },
    { field: 'delivery_city', label: 'Miasto dostawy', type: 'string', table: 'fact_orders', operators: ['eq', 'contains', 'in'] },
    { field: 'coupon_code', label: 'Kod kuponu', type: 'string', table: 'fact_orders', operators: ['eq', 'contains', 'is_null', 'not_null'] },
    { field: 'product_name', label: 'Nazwa produktu', type: 'string', table: 'fact_order_items', operators: ['eq', 'contains', 'not_contains', 'starts_with', 'ends_with'] },
    { field: 'product_category', label: 'Kategoria produktu', type: 'string', table: 'fact_order_items', operators: ['eq', 'contains', 'in'] },
    { field: 'fabric_collection', label: 'Kolekcja tkaniny', type: 'string', table: 'fact_order_items', operators: ['eq', 'contains', 'in'] },
  ],
  measures: [
    { field: 'revenue_gross', label: 'Revenue brutto', type: 'number' },
    { field: 'orders_count', label: 'Liczba zamówień', type: 'number' },
    { field: 'avg_order_value', label: 'Średnia wartość zamówienia', type: 'number' },
    { field: 'quantity', label: 'Suma ilości', type: 'number' },
  ],
};

export async function GET() {
  return NextResponse.json(schema);
}
