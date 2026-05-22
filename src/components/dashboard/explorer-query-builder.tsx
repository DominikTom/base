'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdvancedFilter, QuerySpec } from '@/lib/explorer-whitelist';

type SchemaDimension = { field: string; label: string; type: string; operators: string[] };

const CHART_TYPES = [
  { value: 'bar', label: 'Słupkowy' },
  { value: 'line', label: 'Liniowy' },
  { value: 'area', label: 'Warstwowy' },
  { value: 'pie', label: 'Kołowy' },
  { value: 'table', label: 'Tabela' },
];
const GRANULARITIES = [
  { value: 'day', label: 'Dzień' },
  { value: 'week', label: 'Tydzień' },
  { value: 'month', label: 'Miesiąc' },
  { value: 'quarter', label: 'Kwartał' },
];
const X_AXES = [
  { value: 'date', label: 'Data' },
  { value: 'source_shop', label: 'Sklep' },
  { value: 'product_category', label: 'Kategoria produktu' },
  { value: 'fabric_collection', label: 'Kolekcja tkaniny' },
  { value: 'supplier', label: 'Dostawca' },
  { value: 'source_platform', label: 'Platforma' },
];
const Y_AXES = [
  { value: 'revenue_gross', label: 'Revenue brutto' },
  { value: 'orders_count', label: 'Liczba zamówień' },
  { value: 'avg_order_value', label: 'Średnia wartość zamówienia' },
  { value: 'quantity', label: 'Suma ilości' },
];
const GROUP_BY = [
  { value: '', label: 'Bez grupowania' },
  { value: 'source_shop', label: 'Sklep' },
  { value: 'product_category', label: 'Kategoria' },
  { value: 'fabric_collection', label: 'Kolekcja tkaniny' },
  { value: 'supplier', label: 'Dostawca' },
  { value: 'source_platform', label: 'Platforma' },
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

const SELECT = 'px-3 py-2 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-200';

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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <select value={value.chart_type} onChange={e => patch({ chart_type: e.target.value })} className={SELECT}>
          {CHART_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={value.granularity} onChange={e => patch({ granularity: e.target.value })} className={SELECT}>
          {GRANULARITIES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={value.x_axis} onChange={e => patch({ x_axis: e.target.value })} className={SELECT}>
          {X_AXES.map(o => <option key={o.value} value={o.value}>Oś X: {o.label}</option>)}
        </select>
        <select value={value.y_axis} onChange={e => patch({ y_axis: e.target.value })} className={SELECT}>
          {Y_AXES.map(o => <option key={o.value} value={o.value}>Metryka: {o.label}</option>)}
        </select>
        <select value={value.group_by || ''} onChange={e => patch({ group_by: e.target.value })} className={SELECT}>
          {GROUP_BY.map(o => <option key={o.value} value={o.value}>Grupowanie: {o.label}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs text-zinc-400">Filtry zaawansowane</div>
          <button onClick={addFilter} className="text-xs px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200">
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
                className="md:col-span-3 px-3 py-2 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-200"
              >
                {dimensions.map(d => <option key={d.field} value={d.field}>{d.label}</option>)}
              </select>
              <select
                value={f.operator}
                onChange={e => updateFilter(idx, { operator: e.target.value })}
                className="md:col-span-2 px-3 py-2 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-200"
              >
                {operators.map(op => <option key={op} value={op}>{op}</option>)}
              </select>
              {!hideValue && isBoolean && (
                <select
                  value={f.value || 'true'}
                  onChange={e => updateFilter(idx, { value: e.target.value })}
                  className="md:col-span-3 px-3 py-2 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-200"
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
                  className="md:col-span-3 px-3 py-2 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-200"
                />
              )}
              {needsTo && (
                <input
                  value={f.value_to || ''}
                  onChange={e => updateFilter(idx, { value_to: e.target.value })}
                  placeholder="do"
                  className="md:col-span-2 px-3 py-2 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-200"
                />
              )}
              {hideValue && <div className="md:col-span-5 text-[11px] text-zinc-500">Ten operator nie wymaga wartości.</div>}
              <button
                onClick={() => removeFilter(idx)}
                className="md:col-span-2 px-3 py-2 rounded bg-red-950/50 border border-red-800 text-xs text-red-300"
              >
                Usuń
              </button>
            </div>
          );
        })}
        {filters.length > 0 && (
          <p className="text-[11px] text-zinc-500">Tip: dla operatora „in” podaj wiele wartości oddzielonych przecinkiem.</p>
        )}
      </div>
    </div>
  );
}
