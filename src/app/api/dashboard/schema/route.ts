import { NextResponse } from 'next/server';

const schema = {
  dimensions: [
    { field: 'date', label: 'Data zamówienia', type: 'date', table: 'fact_orders', operators: ['eq', 'between', 'gte', 'lte'] },
    { field: 'source_shop', label: 'Sklep', type: 'string', table: 'fact_orders', operators: ['eq', 'neq', 'in', 'contains'] },
    { field: 'source_platform', label: 'Platforma', type: 'string', table: 'fact_orders', operators: ['eq', 'neq', 'in', 'contains'] },
    { field: 'supplier', label: 'Dostawca', type: 'string', table: 'fact_orders', operators: ['eq', 'neq', 'contains', 'in', 'is_null', 'not_null'] },
    { field: 'status', label: 'Status zamówienia', type: 'string', table: 'fact_orders', operators: ['eq', 'neq', 'in'] },
    { field: 'delivery_city', label: 'Miasto dostawy', type: 'string', table: 'fact_orders', operators: ['eq', 'contains', 'in', 'is_null', 'not_null'] },
    { field: 'coupon_code', label: 'Kod kuponu', type: 'string', table: 'fact_orders', operators: ['eq', 'contains', 'starts_with', 'ends_with', 'is_null', 'not_null'] },
    { field: 'total_gross_pln', label: 'Wartość brutto (PLN)', type: 'number', table: 'fact_orders', operators: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'] },
    { field: 'product_name', label: 'Nazwa produktu', type: 'string', table: 'fact_order_items', operators: ['eq', 'contains', 'not_contains', 'starts_with', 'ends_with'] },
    { field: 'product_category', label: 'Kategoria produktu', type: 'string', table: 'fact_order_items', operators: ['eq', 'contains', 'in'] },
    { field: 'fabric_collection', label: 'Kolekcja tkaniny', type: 'string', table: 'fact_order_items', operators: ['eq', 'contains', 'in'] },
    { field: 'fabric', label: 'Tkanina', type: 'string', table: 'fact_order_items', operators: ['eq', 'contains', 'in'] },
    { field: 'bed_size', label: 'Rozmiar łóżka', type: 'string', table: 'fact_order_items', operators: ['eq', 'contains', 'in'] },
    { field: 'headboard_height', label: 'Wysokość wezgłowia', type: 'string', table: 'fact_order_items', operators: ['eq', 'contains', 'in', 'is_null', 'not_null'] },
    { field: 'storage_type', label: 'Typ stelaża', type: 'string', table: 'fact_order_items', operators: ['eq', 'contains', 'in', 'is_null', 'not_null'] },
    { field: 'quantity', label: 'Ilość sztuk', type: 'number', table: 'fact_order_items', operators: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'] },
    { field: 'is_sample', label: 'Próbka tkaniny', type: 'boolean', table: 'fact_order_items', operators: ['eq'] },
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
