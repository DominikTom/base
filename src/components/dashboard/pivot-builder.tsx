'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUp, ArrowDown, X, Plus, AlertCircle } from 'lucide-react';
import type { QuerySpec, PivotMetric, PivotFormat, AdvancedFilter } from '@/lib/explorer-whitelist';
import { ALLOWED_PIVOT_FORMATS } from '@/lib/explorer-whitelist';
import { validateFormula } from '@/lib/pivot-formula';

// ─────────────────────────────────────────────────────────────────
// Słowniki — etykiety przyjazne user-facing
// ─────────────────────────────────────────────────────────────────
const ROW_DIMS = [
  { value: 'date', label: 'Data' },
  { value: 'source_shop', label: 'Sklep' },
  { value: 'source_platform', label: 'Platforma' },
  { value: 'campaign', label: 'Kampania' },
  { value: 'service_type', label: 'Typ usługi (agencja)' },
  { value: 'supplier', label: 'Dostawca' },
  { value: 'status', label: 'Status zamówienia' },
  { value: 'delivery_city', label: 'Miasto dostawy' },
  { value: 'coupon_code', label: 'Kod kuponu' },
];

const RAW_METRICS = [
  // Zamówienia
  { value: 'revenue_gross', label: '[Zamówienia] Przychód brutto' },
  { value: 'revenue_paid', label: '[Zamówienia] Przychód opłacony' },
  { value: 'orders_count', label: '[Zamówienia] Liczba zamówień' },
  { value: 'orders_paid', label: '[Zamówienia] Zamówienia opłacone' },
  { value: 'orders_cancelled', label: '[Zamówienia] Anulowane' },
  { value: 'avg_order_value', label: '[Zamówienia] AOV' },
  { value: 'shipping_revenue', label: '[Zamówienia] Wysyłka (PLN)' },
  // Meta
  { value: 'meta_spend', label: '[Meta] Spend (PLN)' },
  { value: 'meta_revenue', label: '[Meta] Revenue Meta-reported (PLN)' },
  { value: 'meta_impressions', label: '[Meta] Wyświetlenia' },
  { value: 'meta_clicks', label: '[Meta] Kliknięcia' },
  { value: 'meta_conversions', label: '[Meta] Konwersje' },
  { value: 'meta_ctr', label: '[Meta] CTR (%)' },
  { value: 'meta_cpc', label: '[Meta] CPC (PLN)' },
  { value: 'meta_roas', label: '[Meta] ROAS' },
  // Ruch / Google
  { value: 'google_spend', label: '[Ruch] Google Ads — wydatki (PLN)' },
  { value: 'ga_revenue', label: '[Ruch] Revenue GA4 (PLN)' },
  { value: 'sessions', label: '[Ruch] Sesje' },
  { value: 'users', label: '[Ruch] Użytkownicy' },
  { value: 'transactions', label: '[Ruch] Transakcje' },
  { value: 'pageviews', label: '[Ruch] Odsłony' },
  // Agency
  { value: 'agency_cost', label: '[Agencja] Koszty (PLN)' },
];

const FORMAT_LABELS: Record<PivotFormat, string> = {
  pln: 'PLN',
  pct: '%',
  number: 'liczba',
  ratio: 'x (ROAS)',
};

interface Props {
  value: QuerySpec;
  onChange: (next: QuerySpec) => void;
}

interface TemplateInfo {
  key: string;
  label: string;
  format: PivotFormat;
  expr: string;
}

const SELECT_BASE = 'px-3 py-2 rounded bg-surface border border-line text-sm text-fg';

export function PivotBuilder({ value, onChange }: Props) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);

  useEffect(() => {
    fetch('/api/dashboard/pivot')
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.templates) setTemplates(j.templates); })
      .catch(() => {});
  }, []);

  const rowDims = useMemo(() => value.row_dims || [], [value.row_dims]);
  const metrics = useMemo(() => value.metrics || [], [value.metrics]);
  const filters = useMemo(() => value.filters_advanced || [], [value.filters_advanced]);

  const patch = useCallback((p: Partial<QuerySpec>) => onChange({ ...value, ...p }), [value, onChange]);

  // ── Row dims ──
  const addDim = () => {
    const next = ROW_DIMS.find(d => !rowDims.includes(d.value));
    if (next) patch({ row_dims: [...rowDims, next.value] });
  };
  const updateDim = (idx: number, v: string) => {
    patch({ row_dims: rowDims.map((d, i) => (i === idx ? v : d)) });
  };
  const moveDim = (idx: number, delta: number) => {
    const next = [...rowDims];
    const j = idx + delta;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    patch({ row_dims: next });
  };
  const removeDim = (idx: number) => {
    if (rowDims.length <= 1) return; // przynajmniej 1 wymiar
    patch({ row_dims: rowDims.filter((_, i) => i !== idx) });
  };

  // ── Metrics ──
  const addMetric = (kind: 'raw' | 'template' | 'computed') => {
    let m: PivotMetric;
    if (kind === 'raw') m = { kind: 'raw', key: RAW_METRICS[0].value };
    else if (kind === 'template') m = { kind: 'template', template: templates[0]?.key || 'roas' };
    else m = { kind: 'computed', label: 'Nowa kolumna', expr: 'revenue_gross - meta_spend - google_spend', format: 'pln' };
    patch({ metrics: [...metrics, m] });
  };
  const updateMetric = (idx: number, p: Partial<PivotMetric>) => {
    patch({ metrics: metrics.map((m, i) => (i === idx ? { ...m, ...p } as PivotMetric : m)) });
  };
  const replaceMetric = (idx: number, m: PivotMetric) => {
    patch({ metrics: metrics.map((cur, i) => (i === idx ? m : cur)) });
  };
  const moveMetric = (idx: number, delta: number) => {
    const next = [...metrics];
    const j = idx + delta;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    patch({ metrics: next });
  };
  const removeMetric = (idx: number) => {
    patch({ metrics: metrics.filter((_, i) => i !== idx) });
  };

  // ── Filters (subset z explorera — w pivocie wystarczy minimum) ──
  const addFilter = () => {
    patch({ filters_advanced: [...filters, { field: 'source_shop', operator: 'eq', value: '' }] });
  };
  const updateFilter = (idx: number, p: Partial<AdvancedFilter>) => {
    patch({ filters_advanced: filters.map((f, i) => (i === idx ? { ...f, ...p } : f)) });
  };
  const removeFilter = (idx: number) => {
    patch({ filters_advanced: filters.filter((_, i) => i !== idx) });
  };

  // Allowed identifiers dla walidacji computed (raw keys + template keys + wcześniejsze computed labels).
  const allowedScope = useMemo(() => {
    const out = new Set<string>(RAW_METRICS.map(r => r.value));
    metrics.forEach(m => {
      if (m.kind === 'template') out.add(m.template);
      if (m.kind === 'computed') out.add(m.label);
    });
    return [...out];
  }, [metrics]);

  return (
    <div className="space-y-5">
      {/* Granularity (gdy 'date' jest w wymiarach) */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-muted">Granulacja daty</label>
        <select value={value.granularity} onChange={e => patch({ granularity: e.target.value })} className={SELECT_BASE}>
          <option value="day">Dzień</option>
          <option value="week">Tydzień</option>
          <option value="month">Miesiąc</option>
          <option value="quarter">Kwartał</option>
        </select>
        {!rowDims.includes('date') && (
          <span className="text-[11px] text-muted">(używana tylko gdy „Data” jest wymiarem)</span>
        )}
      </div>

      {/* Wymiary (wiersze) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-fg-soft">Wymiary (wiersze)</div>
          <button
            type="button"
            onClick={addDim}
            disabled={rowDims.length >= ROW_DIMS.length}
            className="text-xs px-2 py-1 rounded bg-line hover:bg-zinc-600 text-fg disabled:opacity-40"
          >
            + dodaj wymiar
          </button>
        </div>
        {rowDims.map((d, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-2 items-center">
            <select value={d} onChange={e => updateDim(idx, e.target.value)} className={`col-span-8 ${SELECT_BASE}`}>
              {ROW_DIMS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button type="button" onClick={() => moveDim(idx, -1)} disabled={idx === 0} className="col-span-1 p-2 text-muted hover:text-fg disabled:opacity-30"><ArrowUp size={14} /></button>
            <button type="button" onClick={() => moveDim(idx, 1)} disabled={idx === rowDims.length - 1} className="col-span-1 p-2 text-muted hover:text-fg disabled:opacity-30"><ArrowDown size={14} /></button>
            <button type="button" onClick={() => removeDim(idx)} disabled={rowDims.length <= 1} className="col-span-2 px-3 py-2 rounded bg-red-50 border border-red-200 text-xs text-danger disabled:opacity-30">Usuń</button>
          </div>
        ))}
      </div>

      {/* Metryki (kolumny) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-fg-soft">Kolumny (metryki)</div>
          <div className="flex gap-1">
            <button type="button" onClick={() => addMetric('raw')} className="text-xs px-2 py-1 rounded bg-line hover:bg-zinc-600 text-fg">+ metryka</button>
            <button type="button" onClick={() => addMetric('template')} className="text-xs px-2 py-1 rounded bg-primary-100 hover:bg-primary-700/50 text-primary-700 border border-primary-300">+ szablon</button>
            <button type="button" onClick={() => addMetric('computed')} className="text-xs px-2 py-1 rounded bg-primary-100 hover:bg-primary-200 text-primary-700 border border-primary-300">+ formuła</button>
          </div>
        </div>

        {metrics.length === 0 && (
          <div className="text-xs text-muted italic px-2 py-3">
            Dodaj przynajmniej jedną metrykę. „Metryka” = surowa kolumna z bazy. „Szablon” = gotowa formuła (ROAS, Profit, itd.). „Formuła” = własne wyrażenie po nazwach kolumn.
          </div>
        )}

        {metrics.map((m, idx) => (
          <MetricRow
            key={idx}
            metric={m}
            templates={templates}
            allowedScope={allowedScope}
            onChange={p => updateMetric(idx, p)}
            onReplace={next => replaceMetric(idx, next)}
            onMoveUp={() => moveMetric(idx, -1)}
            onMoveDown={() => moveMetric(idx, 1)}
            onRemove={() => removeMetric(idx)}
            canMoveUp={idx > 0}
            canMoveDown={idx < metrics.length - 1}
          />
        ))}
      </div>

      {/* Filtry (uproszczone — jeden field/op/value) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-fg-soft">Filtry</div>
          <button type="button" onClick={addFilter} className="text-xs px-2 py-1 rounded bg-line hover:bg-zinc-600 text-fg">+ filtr</button>
        </div>
        {filters.map((f, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-2">
            <select value={f.field} onChange={e => updateFilter(idx, { field: e.target.value })} className={`col-span-4 ${SELECT_BASE} text-xs`}>
              <option value="source_shop">Sklep</option>
              <option value="source_platform">Platforma</option>
              <option value="campaign">Kampania</option>
              <option value="service_type">Typ usługi</option>
              <option value="platform">Platforma (agencja)</option>
              <option value="supplier">Dostawca</option>
              <option value="status">Status</option>
            </select>
            <select value={f.operator} onChange={e => updateFilter(idx, { operator: e.target.value })} className={`col-span-2 ${SELECT_BASE} text-xs`}>
              <option value="eq">=</option>
              <option value="neq">≠</option>
              <option value="contains">zawiera</option>
              <option value="starts_with">zaczyna się</option>
              <option value="in">w liście</option>
            </select>
            <input
              value={String(f.value || '')}
              onChange={e => updateFilter(idx, { value: e.target.value })}
              placeholder={f.operator === 'in' ? 'np. mybed.pl, mybed.de' : 'wartość'}
              className={`col-span-4 ${SELECT_BASE} text-xs`}
            />
            <button type="button" onClick={() => removeFilter(idx)} className="col-span-2 px-3 py-2 rounded bg-red-50 border border-red-200 text-xs text-danger">Usuń</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Wiersz pojedynczej metryki
// ─────────────────────────────────────────────────────────────────
function MetricRow({
  metric, templates, allowedScope,
  onChange, onReplace, onMoveUp, onMoveDown, onRemove,
  canMoveUp, canMoveDown,
}: {
  metric: PivotMetric;
  templates: TemplateInfo[];
  allowedScope: string[];
  onChange: (p: Partial<PivotMetric>) => void;
  onReplace: (m: PivotMetric) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const kindLabel = metric.kind === 'raw' ? 'metryka'
    : metric.kind === 'template' ? 'szablon'
    : 'formuła';
  const kindColor = metric.kind === 'raw' ? 'bg-bg text-fg-soft'
    : metric.kind === 'template' ? 'bg-primary-100 text-primary-700 border border-primary-300'
    : 'bg-primary-100 text-primary-700 border border-primary-300';

  return (
    <div className="rounded-lg border border-line bg-surface p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase ${kindColor}`}>{kindLabel}</span>
        <div className="flex-1" />
        <button type="button" onClick={onMoveUp} disabled={!canMoveUp} className="p-1 text-muted hover:text-fg disabled:opacity-30"><ArrowUp size={14} /></button>
        <button type="button" onClick={onMoveDown} disabled={!canMoveDown} className="p-1 text-muted hover:text-fg disabled:opacity-30"><ArrowDown size={14} /></button>
        <button type="button" onClick={onRemove} className="p-1 text-muted hover:text-danger"><X size={14} /></button>
      </div>

      {metric.kind === 'raw' && (
        <div className="grid grid-cols-12 gap-2">
          <select value={metric.key} onChange={e => onChange({ key: e.target.value } as Partial<PivotMetric>)} className={`col-span-7 ${SELECT_BASE} text-xs`}>
            {RAW_METRICS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            value={metric.label || ''}
            onChange={e => onChange({ label: e.target.value })}
            placeholder="Nazwa kolumny (opcjonalnie)"
            className={`col-span-3 ${SELECT_BASE} text-xs`}
          />
          <select value={metric.format || ''} onChange={e => onChange({ format: (e.target.value || undefined) as PivotFormat })} className={`col-span-2 ${SELECT_BASE} text-xs`}>
            <option value="">auto</option>
            {ALLOWED_PIVOT_FORMATS.map(f => <option key={f} value={f}>{FORMAT_LABELS[f as PivotFormat]}</option>)}
          </select>
        </div>
      )}

      {metric.kind === 'template' && (
        <div className="grid grid-cols-12 gap-2">
          <select value={metric.template} onChange={e => onChange({ template: e.target.value } as Partial<PivotMetric>)} className={`col-span-7 ${SELECT_BASE} text-xs`}>
            {templates.length === 0 && <option value="roas">ROAS</option>}
            {templates.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <input
            value={metric.label || ''}
            onChange={e => onChange({ label: e.target.value })}
            placeholder="Nazwa kolumny (opcjonalnie)"
            className={`col-span-3 ${SELECT_BASE} text-xs`}
          />
          <select value={metric.format || ''} onChange={e => onChange({ format: (e.target.value || undefined) as PivotFormat })} className={`col-span-2 ${SELECT_BASE} text-xs`}>
            <option value="">auto</option>
            {ALLOWED_PIVOT_FORMATS.map(f => <option key={f} value={f}>{FORMAT_LABELS[f as PivotFormat]}</option>)}
          </select>
          {templates.find(t => t.key === metric.template) && (
            <div className="col-span-12 text-[11px] text-muted font-mono px-1">
              {templates.find(t => t.key === metric.template)?.expr}
            </div>
          )}
        </div>
      )}

      {metric.kind === 'computed' && <ComputedRow metric={metric} allowedScope={allowedScope} onChange={onChange} onReplace={onReplace} />}
    </div>
  );
}

function ComputedRow({
  metric, allowedScope, onChange,
}: {
  metric: Extract<PivotMetric, { kind: 'computed' }>;
  allowedScope: string[];
  onChange: (p: Partial<PivotMetric>) => void;
  onReplace: (m: PivotMetric) => void;
}) {
  const errors = useMemo(() => validateFormula(metric.expr || '', allowedScope), [metric.expr, allowedScope]);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-12 gap-2">
        <input
          value={metric.label}
          onChange={e => onChange({ label: e.target.value })}
          placeholder="Nazwa kolumny"
          className={`col-span-7 ${SELECT_BASE} text-xs`}
        />
        <select value={metric.format || ''} onChange={e => onChange({ format: (e.target.value || undefined) as PivotFormat })} className={`col-span-2 ${SELECT_BASE} text-xs`}>
          <option value="">auto</option>
          {ALLOWED_PIVOT_FORMATS.map(f => <option key={f} value={f}>{FORMAT_LABELS[f as PivotFormat]}</option>)}
        </select>
      </div>
      <textarea
        value={metric.expr}
        onChange={e => onChange({ expr: e.target.value })}
        placeholder="np. revenue_gross - meta_spend - google_spend - agency_cost"
        rows={2}
        className="w-full px-3 py-2 rounded bg-surface border border-line text-xs text-fg font-mono"
      />
      {errors.length > 0 && (
        <div className="flex items-start gap-1.5 text-[11px] text-danger">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span>{errors.join('; ')}</span>
        </div>
      )}
      <details className="text-[11px] text-muted">
        <summary className="cursor-pointer hover:text-fg-soft">Dostępne nazwy</summary>
        <div className="mt-1 font-mono leading-relaxed">{allowedScope.join(', ')}</div>
      </details>
    </div>
  );
}

// Pomocniczy default — dla `kpi/page.tsx` żeby zainicjalizować pivot przy switchu.
export const EMPTY_PIVOT_SPEC: QuerySpec = {
  chart_type: 'pivot',
  x_axis: 'date',
  y_axis: 'revenue_gross',
  granularity: 'month',
  filters_advanced: [],
  row_dims: ['date', 'source_shop'],
  metrics: [
    { kind: 'raw', key: 'revenue_gross' },
    { kind: 'raw', key: 'meta_spend' },
    { kind: 'raw', key: 'google_spend' },
    { kind: 'template', template: 'roas' },
  ],
};

// Pomocniczy export — przycisk „Plus" gdzieś indziej.
export function _PlusIconForExport() { return <Plus />; }
