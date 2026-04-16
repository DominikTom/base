export interface WidgetDefinition {
  type: string;
  name: string;
  category: 'KPI' | 'Ranking' | 'Wykres' | 'Tabela';
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  component: 'kpi' | 'ranking' | 'bar' | 'line' | 'area' | 'pie' | 'table';
}

export const WIDGET_CATALOG: WidgetDefinition[] = [
  // ── KPI Cards ──
  { type: 'kpi_revenue', name: 'Revenue brutto', category: 'KPI', defaultSize: { w: 3, h: 2 }, component: 'kpi' },
  { type: 'kpi_revenue_paid', name: 'Revenue opłaconych', category: 'KPI', defaultSize: { w: 3, h: 2 }, component: 'kpi' },
  { type: 'kpi_revenue_unpaid', name: 'Revenue nieopłaconych', category: 'KPI', defaultSize: { w: 3, h: 2 }, component: 'kpi' },
  { type: 'kpi_orders', name: 'Zamówienia (total)', category: 'KPI', defaultSize: { w: 3, h: 2 }, component: 'kpi' },
  { type: 'kpi_orders_beds', name: 'Zamówienia łóżek', category: 'KPI', defaultSize: { w: 3, h: 2 }, component: 'kpi' },
  { type: 'kpi_orders_samples', name: 'Zamówienia próbek', category: 'KPI', defaultSize: { w: 3, h: 2 }, component: 'kpi' },
  { type: 'kpi_aov', name: 'AOV', category: 'KPI', defaultSize: { w: 3, h: 2 }, component: 'kpi' },
  { type: 'kpi_payment_rate', name: 'Wskaźnik płatności', category: 'KPI', defaultSize: { w: 3, h: 2 }, component: 'kpi' },

  // ── Rankings ──
  { type: 'ranking_models', name: 'Ranking modeli (bez próbek)', category: 'Ranking', defaultSize: { w: 6, h: 5 }, component: 'ranking' },
  { type: 'ranking_fabric_collections', name: 'Ranking kolekcji tkanin', category: 'Ranking', defaultSize: { w: 6, h: 5 }, component: 'ranking' },
  { type: 'ranking_fabrics', name: 'Ranking tkanin', category: 'Ranking', defaultSize: { w: 6, h: 5 }, component: 'ranking' },
  { type: 'ranking_cities', name: 'Ranking miast', category: 'Ranking', defaultSize: { w: 6, h: 5 }, component: 'ranking' },
  { type: 'ranking_suppliers', name: 'Ranking dostawców', category: 'Ranking', defaultSize: { w: 6, h: 5 }, component: 'ranking' },
  { type: 'ranking_coupons', name: 'Ranking kuponów', category: 'Ranking', defaultSize: { w: 6, h: 5 }, component: 'ranking' },
  { type: 'ranking_bed_sizes', name: 'Ranking rozmiarów łóżek', category: 'Ranking', defaultSize: { w: 6, h: 5 }, component: 'ranking' },
  { type: 'ranking_headboard_heights', name: 'Ranking wys. wezgłowia', category: 'Ranking', defaultSize: { w: 6, h: 5 }, component: 'ranking' },
  { type: 'ranking_storage_types', name: 'Ranking stelaży', category: 'Ranking', defaultSize: { w: 6, h: 5 }, component: 'ranking' },

  // ── Charts ──
  { type: 'chart_orders_timeline', name: 'Produkty/zamówienia w czasie', category: 'Wykres', defaultSize: { w: 8, h: 5 }, component: 'line' },
  { type: 'chart_revenue_timeline', name: 'Revenue w czasie per sklep', category: 'Wykres', defaultSize: { w: 8, h: 5 }, component: 'area' },
  { type: 'chart_payment_status', name: 'Status płatności', category: 'Wykres', defaultSize: { w: 4, h: 5 }, component: 'pie' },
  { type: 'chart_suppliers', name: 'Podział dostawców', category: 'Wykres', defaultSize: { w: 4, h: 5 }, component: 'pie' },
  { type: 'chart_mattress_types', name: 'Typ materaca', category: 'Wykres', defaultSize: { w: 4, h: 5 }, component: 'pie' },
  { type: 'chart_daily_orders', name: 'Zamówienia dziennie', category: 'Wykres', defaultSize: { w: 6, h: 4 }, component: 'bar' },

  // ── Tables ──
  { type: 'table_payment_status', name: 'Status płatności (tabela)', category: 'Tabela', defaultSize: { w: 6, h: 4 }, component: 'table' },
  { type: 'table_fabric_samples', name: 'Próbki tkanin', category: 'Tabela', defaultSize: { w: 12, h: 5 }, component: 'table' },
];

export function getWidgetDef(type: string): WidgetDefinition | undefined {
  return WIDGET_CATALOG.find(w => w.type === type);
}
