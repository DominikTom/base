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
    { field: 'mattress_type', label: 'Typ materaca', type: 'string', table: 'fact_order_items', operators: ['eq', 'contains', 'in', 'is_null', 'not_null'] },
    { field: 'headboard_height', label: 'Wysokość wezgłowia', type: 'string', table: 'fact_order_items', operators: ['eq', 'contains', 'in', 'is_null', 'not_null'] },
    { field: 'storage_type', label: 'Typ stelaża', type: 'string', table: 'fact_order_items', operators: ['eq', 'contains', 'in', 'is_null', 'not_null'] },
    { field: 'quantity', label: 'Ilość sztuk', type: 'number', table: 'fact_order_items', operators: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'] },
    { field: 'is_sample', label: 'Próbka tkaniny', type: 'boolean', table: 'fact_order_items', operators: ['eq'] },
  ],
  measures: [
    // Zamówienia (fact_orders + items)
    { field: 'revenue_gross', label: 'Przychód brutto', type: 'number', dataset: 'orders' },
    { field: 'revenue_paid', label: 'Przychód opłacony', type: 'number', dataset: 'orders' },
    { field: 'shipping_revenue', label: 'Przychód z wysyłki', type: 'number', dataset: 'orders' },
    { field: 'orders_count', label: 'Liczba zamówień', type: 'number', dataset: 'orders' },
    { field: 'orders_paid', label: 'Zamówienia opłacone', type: 'number', dataset: 'orders' },
    { field: 'orders_cancelled', label: 'Zamówienia anulowane', type: 'number', dataset: 'orders' },
    { field: 'avg_order_value', label: 'Średnia wartość zamówienia (AOV)', type: 'number', dataset: 'orders' },
    { field: 'quantity', label: 'Suma sztuk', type: 'number', dataset: 'orders' },
    // Meta Ads
    { field: 'meta_spend', label: 'Meta Ads — wydatki', type: 'number', dataset: 'meta' },
    { field: 'meta_revenue', label: 'Meta Ads — przychód (Meta-reported)', type: 'number', dataset: 'meta' },
    { field: 'meta_impressions', label: 'Meta Ads — wyświetlenia', type: 'number', dataset: 'meta' },
    { field: 'meta_clicks', label: 'Meta Ads — kliknięcia', type: 'number', dataset: 'meta' },
    { field: 'meta_conversions', label: 'Meta Ads — konwersje', type: 'number', dataset: 'meta' },
    { field: 'meta_ctr', label: 'Meta Ads — CTR (%)', type: 'number', dataset: 'meta' },
    { field: 'meta_cpc', label: 'Meta Ads — CPC', type: 'number', dataset: 'meta' },
    { field: 'meta_roas', label: 'Meta Ads — ROAS', type: 'number', dataset: 'meta' },
    // Ruch / GA4 / Google Ads
    { field: 'google_spend', label: 'Google Ads — wydatki', type: 'number', dataset: 'traffic' },
    { field: 'sessions', label: 'Sesje', type: 'number', dataset: 'traffic' },
    { field: 'users', label: 'Użytkownicy', type: 'number', dataset: 'traffic' },
    { field: 'transactions', label: 'Transakcje', type: 'number', dataset: 'traffic' },
    { field: 'ga_revenue', label: 'Przychód GA4', type: 'number', dataset: 'traffic' },
    { field: 'pageviews', label: 'Odsłony', type: 'number', dataset: 'traffic' },
  ],
};

export async function GET() {
  return NextResponse.json(schema);
}
