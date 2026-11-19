'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdvancedFilter, QuerySpec } from '@/lib/explorer-whitelist';

type SchemaDimension = { field: string; label: string; type: string; operators: string[] };

const GRANULARITIES = [
  { value: 'day', label: 'Dzień' },
  { value: 'week', label: 'Tydzień' },
  { value: 'month', label: 'Miesiąc' },
  { value: 'quarter', label: 'Kwartał' },
];
const X_AXES = [
  { value: 'date', label: 'Data' },
  { value: 'source_shop', label: 'Sklep' },
  { value: 'source_platform', label: 'Platforma' },
  { value: 'supplier', label: 'Dostawca' },
  { value: 'delivery_city', label: 'Miasto dostawy' },
  { value: 'status', label: 'Status zamówienia' },
  { value: 'coupon_code', label: 'Kod kuponu' },
  { value: 'product_category', label: 'Kategoria produktu' },
  { value: 'fabric_collection', label: 'Kolekcja tkaniny' },
  { value: 'bed_size', label: 'Rozmiar łóżka' },
  { value: 'mattress_type', label: 'Typ materaca' },
  { value: 'headboard_height', label: 'Wezgłowie' },
];
// Pogrupowane logicznie po datasetach (orders / Meta Ads / Ruch).
const Y_AXES = [
  // Zamówienia
  { value: 'revenue_gross', label: '[Zamówienia] Przychód brutto (PLN)' },
  { value: 'revenue_paid', label: '[Zamówienia] Przychód opłacony (PLN)' },
  { value: 'shipping_revenue', label: '[Zamówienia] Przychód z wysyłki (PLN)' },
  { value: 'orders_count', label: '[Zamówienia] Liczba zamówień' },
  { value: 'orders_paid', label: '[Zamówienia] Zamówienia opłacone' },
  { value: 'orders_cancelled', label: '[Zamówienia] Zamówienia anulowane' },
  { value: 'avg_order_value', label: '[Zamówienia] Średnia wartość zamówienia (AOV)' },
  { value: 'quantity', label: '[Zamówienia] Suma sztuk' },
  // Meta Ads
  { value: 'meta_spend', label: '[Meta Ads] Wydatki (PLN)' },
  { value: 'meta_revenue', label: '[Meta Ads] Przychód Meta-reported (PLN)' },
  { value: 'meta_impressions', label: '[Meta Ads] Wyświetlenia' },
  { value: 'meta_clicks', label: '[Meta Ads] Kliknięcia' },
  { value: 'meta_conversions', label: '[Meta Ads] Konwersje' },
  { value: 'meta_ctr', label: '[Meta Ads] CTR (%)' },
  { value: 'meta_cpc', label: '[Meta Ads] CPC (PLN)' },
  { value: 'meta_roas', label: '[Meta Ads] ROAS' },
  // Ruch / GA4 / Google Ads
  { value: 'google_spend', label: '[Ruch] Google Ads — wydatki (PLN)' },
  { value: 'sessions', label: '[Ruch] Sesje' },
  { value: 'users', label: '[Ruch] Użytkownicy' },
  { value: 'transactions', label: '[Ruch] Transakcje' },
  { value: 'ga_revenue', label: '[Ruch] Przychód GA4 (PLN)' },
  { value: 'pageviews', label: '[Ruch] Odsłony' },
];
const GROUP_BY = [
  { value: '', label: 'Bez grupowania' },
  { value: 'source_shop', label: 'Sklep' },
  { value: 'source_platform', label: 'Platforma' },
  { value: 'supplier', label: 'Dostawca' },
  { value: 'status', label: 'Status zamówienia' },
  { value: 'delivery_city', label: 'Miasto dostawy' },
  { value: 'product_category', label: 'Kategoria produktu' },
  { value: 'fabric_collection', label: 'Kolekcja tkaniny' },
  { value: 'bed_size', label: 'Rozmiar łóżka' },
  { value: 'mattress_type', label: 'Typ materaca' },
  { value: 'headboard_height', label: 'Wezgłowie' },
];

export const EMPTY_QUERY_SPEC: QuerySpec = {
  chart_type: 'bar',
  x_axis: 'date',
  y_axis: 'revenue_gross',
  group_by: '',
  granularity: 'month',
  filters_advanced: [],
};

interface Props {
  value: QuerySpec;
  onChange: (next: QuerySpec) => void;
}

const SELECT = 'px-3 py-2 rounded-xl border border-line bg-surface text-sm text-ink-soft focus:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/10';

// Współdzielony kreator zapytania (oś X/Y, grupowanie, granulacja, filtry).
// Używany przez kreator widgetów ("Mój Dashboard") i modal "Nowy KPI".
export function ExplorerQueryBuilder({ value, onChange }: Props) {
  const [dimensions, setDimensions] = useState<SchemaDimension[]>([]);

  useEffect(() => {
    fetch('/api/dashboard/schema')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j?.dimensions) setDimensions(j.dimensions); })
      .catch(() => {});
  }, []);

  const filters = useMemo(() => value.filters_advanced || [], [value.filters_advanced]);

  const patch = useCallback((p: Partial<QuerySpec>) => onChange({ ...value, ...p }), [value, onChange]);

  const addFilter = useCallback(() => {
    const first = dimensions[0];
    if (!first) return;
    patch({
      filters_advanced: [
        ...filters,
        { field: first.field, operator: first.operators[0] || 'eq', value: '' },
      ],
    });
  }, [dimensions, filters, patch]);

  const updateFilter = useCallback((idx: number, p: Partial<AdvancedFilter>) => {
    patch({ filters_advanced: filters.map((f, i) => (i === idx ? { ...f, ...p } : f)) });
  }, [filters, patch]);

  const removeFilter = useCallback((idx: number) => {
    patch({ filters_advanced: filters.filter((_, i) => i !== idx) });
  }, [filters, patch]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <select value={value.x_axis} onChange={e => patch({ x_axis: e.target.value })} className={SELECT}>
          {X_AXES.map(o => <option key={o.value} value={o.value}>Oś X: {o.label}</option>)}
        </select>
        <select value={value.y_axis} onChange={e => patch({ y_axis: e.target.value })} className={SELECT}>
          {Y_AXES.map(o => <option key={o.value} value={o.value}>Metryka: {o.label}</option>)}
        </select>
        <select value={value.group_by || ''} onChange={e => patch({ group_by: e.target.value })} className={SELECT}>
          {GROUP_BY.map(o => <option key={o.value} value={o.value}>Grupowanie: {o.label}</option>)}
        </select>
        <select value={value.granularity} onChange={e => patch({ granularity: e.target.value })} className={SELECT}>
          {GRANULARITIES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="stat-label">Filtry zaawansowane</div>
          <button onClick={addFilter} className="btn-secondary px-2 py-1 text-xs font-medium">
            + filtr
          </button>
        </div>
        {filters.map((f, idx) => {
          const dim = dimensions.find(d => d.field === f.field) || dimensions[0];
          const operators = dim?.operators || ['eq'];
          const hideValue = f.operator === 'is_null' || f.operator === 'not_null';
          const needsTo = f.operator === 'between';
          const isIn = f.operator === 'in';
          const isBoolean = dim?.type === 'boolean';
          return (
            <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
              <select
                value={f.field}
                onChange={e => {
                  const nd = dimensions.find(d => d.field === e.target.value);
                  updateFilter(idx, {
                    field: e.target.value,
                    operator: nd?.operators?.[0] || 'eq',
                    value: nd?.type === 'boolean' ? 'true' : '',
                    value_to: '',
                  });
                }}
                className="md:col-span-3 px-3 py-2 rounded-xl border border-line bg-surface text-xs text-ink-soft focus:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/10"
              >
                {dimensions.map(d => <option key={d.field} value={d.field}>{d.label}</option>)}
              </select>
              <select
                value={f.operator}
                onChange={e => updateFilter(idx, { operator: e.target.value })}
                className="md:col-span-2 px-3 py-2 rounded-xl border border-line bg-surface text-xs text-ink-soft focus:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/10"
              >
                {operators.map(op => <option key={op} value={op}>{op}</option>)}
              </select>
              {!hideValue && isBoolean && (
                <select
                  value={f.value || 'true'}
                  onChange={e => updateFilter(idx, { value: e.target.value })}
                  className="md:col-span-3 px-3 py-2 rounded-xl border border-line bg-surface text-xs text-ink-soft focus:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/10"
                >
                  <option value="true">Tak</option>
                  <option value="false">Nie</option>
                </select>
              )}
              {!hideValue && !isBoolean && (
                <input
                  value={f.value || ''}
                  onChange={e => updateFilter(idx, { value: e.target.value })}
                  placeholder={isIn ? 'np. sofa, łóżko, materac' : 'wartość'}
                  className="md:col-span-3 px-3 py-2 rounded-xl border border-line bg-surface text-xs text-ink-soft focus:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/10"
                />
              )}
              {needsTo && (
                <input
                  value={f.value_to || ''}
                  onChange={e => updateFilter(idx, { value_to: e.target.value })}
                  placeholder="do"
                  className="md:col-span-2 px-3 py-2 rounded-xl border border-line bg-surface text-xs text-ink-soft focus:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/10"
                />
              )}
              {hideValue && <div className="md:col-span-5 text-[11px] text-ink-faint">Ten operator nie wymaga wartości.</div>}
              <button
                onClick={() => removeFilter(idx)}
                className="md:col-span-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700"
              >
                Usuń
              </button>
            </div>
          );
        })}
        {filters.length > 0 && (
          <p className="text-[11px] text-ink-faint">Tip: dla operatora „in” podaj wiele wartości oddzielonych przecinkiem.</p>
        )}
      </div>
    </div>
  );
}
