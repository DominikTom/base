'use client';

import { useEffect, useState } from 'react';
import { useDashboard } from '@/lib/dashboard-context';
import { getWidgetDef } from '@/lib/widget-definitions';
import { formatCurrency, formatNumber, SHOP_COLORS } from '@/lib/utils';
import { SimpleBarChart } from '@/components/charts/bar-chart';
import { SimplePieChart } from '@/components/charts/pie-chart';
import { PivotRenderer } from '@/components/dashboard/pivot-renderer';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { X, RefreshCw, ArrowUp, ArrowDown, Maximize2, Minimize2, HelpCircle, TrendingUp, TrendingDown } from 'lucide-react';

// Map widget types to cross-filter fields they produce when clicked
const WIDGET_CLICK_FIELD: Record<string, string> = {
  ranking_models: 'product_name',
  ranking_fabric_collections: 'fabric_collection',
  ranking_fabrics: 'fabric',
  ranking_cities: 'delivery_city',
  ranking_suppliers: 'supplier',
  ranking_coupons: 'coupon_code',
  ranking_bed_sizes: 'bed_size',
  ranking_headboard_heights: 'headboard_height',
  ranking_storage_types: 'storage_type',
};

const FIELD_LABELS: Record<string, string> = {
  product_name: 'Model',
  fabric_collection: 'Kolekcja',
  fabric: 'Tkanina',
  delivery_city: 'Miasto',
  supplier: 'Dostawca',
  coupon_code: 'Kupon',
  bed_size: 'Rozmiar',
  headboard_height: 'Wezgłowie',
  storage_type: 'Stelaż',
};

interface WidgetRendererProps {
  widgetType: string;
  widgetConfig?: Record<string, unknown>;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onResize?: (delta: number) => void;
}

export function WidgetRenderer({ widgetType, widgetConfig, onRemove, onMoveUp, onMoveDown, onResize }: WidgetRendererProps) {
  const { filters, crossFilters, addCrossFilter } = useDashboard();
  const def = getWidgetDef(widgetType);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  // Wartość poprzedniego okresu — tylko dla widgetów typu kpi_*. Pokazujemy
  // jako badge ze zmianą % pod główną liczbą.
  const [prevValue, setPrevValue] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetch_() {
      setLoading(true);
      setError(null);
      try {
        const isPivot = widgetType === 'custom_explorer' && widgetConfig?.chart_type === 'pivot';
        const res = isPivot
          ? await fetch('/api/dashboard/pivot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              row_dims: widgetConfig?.row_dims || ['date'],
              metrics: widgetConfig?.metrics || [],
              granularity: widgetConfig?.granularity || 'month',
              date_from: filters.dateFrom,
              date_to: filters.dateTo,
              filters: { shop: filters.shop !== 'all' ? [filters.shop] : [] },
              filters_advanced: widgetConfig?.filters_advanced || [],
            }),
          })
          : widgetType === 'custom_explorer'
          ? await fetch('/api/dashboard/explorer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              x_axis: widgetConfig?.x_axis || 'date',
              y_axis: widgetConfig?.y_axis || 'revenue_gross',
              group_by: widgetConfig?.group_by || undefined,
              granularity: widgetConfig?.granularity || 'day',
              date_from: filters.dateFrom,
              date_to: filters.dateTo,
              filters: { shop: filters.shop !== 'all' ? [filters.shop] : [] },
              filters_advanced: widgetConfig?.filters_advanced || [],
            }),
          })
          : await fetch('/api/dashboard/widgets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              widget: widgetType,
              dateFrom: filters.dateFrom,
              dateTo: filters.dateTo,
              shop: filters.shop,
              // Rankings dostają wyższy limit — karta i tak scrolluje przez
              // overflow-y-auto, więc widzisz wszystkie pozycje. KPI/wykresy
              // tego limitu nie używają, więc bezpiecznie podbić globalnie.
              limit: 1000,
              crossFilters,
            }),
          });
        if (!cancelled) {
          const json = await res.json();
          if (!res.ok) setError(json.error || 'Błąd');
          else if (isPivot) {
            setData({
              type: 'pivot',
              pivot: json,
              debug: {
                dateFrom: filters.dateFrom,
                dateTo: filters.dateTo,
                shop: filters.shop,
                query: '/api/dashboard/pivot',
              },
            });
          } else if (widgetType === 'custom_explorer') {
            setData({
              type: widgetConfig?.chart_type || 'bar',
              data: json.data || [],
              shops: json.groups || [],
              columns: ['Wymiar', ...(json.groups || [])],
              dataRows: json.data || [],
              debug: {
                dateFrom: filters.dateFrom,
                dateTo: filters.dateTo,
                shop: filters.shop,
                query: '/api/dashboard/explorer',
              },
            });
          } else setData(json);
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetch_();
    return () => { cancelled = true; };
  }, [widgetType, widgetConfig, filters.dateFrom, filters.dateTo, filters.shop, crossFilters]);

  // Poprzedni okres (long-running silent fetch) — tylko dla KPI.
  // Dzieli okres po długości current i pyta API jeszcze raz.
  useEffect(() => {
    if (!widgetType.startsWith('kpi_')) { setPrevValue(null); return; }
    let cancelled = false;
    const fromD = new Date(filters.dateFrom);
    const toD = new Date(filters.dateTo);
    if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) return;
    const days = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1);
    const prevTo = new Date(fromD); prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (days - 1));
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    async function fetchPrev() {
      try {
        const res = await fetch('/api/dashboard/widgets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            widget: widgetType,
            dateFrom: fmt(prevFrom),
            dateTo: fmt(prevTo),
            shop: filters.shop,
            limit: 20,
            crossFilters,
          }),
        });
        const j = await res.json();
        if (cancelled) return;
        setPrevValue(res.ok && typeof j.value === 'number' ? j.value : null);
      } catch { if (!cancelled) setPrevValue(null); }
    }
    fetchPrev();
    return () => { cancelled = true; };
  }, [widgetType, filters.dateFrom, filters.dateTo, filters.shop, crossFilters]);

  const handleItemClick = (name: string) => {
    const field = WIDGET_CLICK_FIELD[widgetType];
    if (!field) return;
    addCrossFilter({
      field,
      value: name,
      label: `${FIELD_LABELS[field] || field}: ${name}`,
    });
  };

  // Wartości aktywne dla pola tego widgetu — żeby ranking podświetlił wybrane wiersze.
  const activeField = WIDGET_CLICK_FIELD[widgetType];
  const activeValues = new Set(
    crossFilters
      .filter(cf => cf.field === activeField)
      .map(cf => cf.value.toLowerCase()),
  );

  if (!def) return <div className="p-4 text-danger">Nieznany widget: {widgetType}</div>;

  return (
    <div className="h-full flex flex-col rounded-card border border-line bg-surface overflow-hidden shadow-card hover:shadow-card-hover transition-shadow">
      {/* Header — drag handle dla react-grid-layout (selector `.widget-drag-handle`) */}
      <div className="widget-drag-handle flex items-center justify-between px-3 py-2 border-b border-line shrink-0 cursor-move select-none">
        <span className="text-xs font-medium text-fg-soft truncate">{String(widgetConfig?.title || def.name)}</span>
        {/* Przyciski — `widget-no-drag` żeby klik w nie nie inicjował drag */}
        <div className="widget-no-drag flex items-center gap-0.5">
          <button onClick={() => setShowDebug(d => !d)} className={`p-1 ${showDebug ? 'text-primary-700' : 'text-muted'} hover:text-primary-700`} title="Debug info"><HelpCircle size={12} /></button>
          {onMoveUp && <button onClick={onMoveUp} className="p-1 text-muted hover:text-fg-soft"><ArrowUp size={12} /></button>}
          {onMoveDown && <button onClick={onMoveDown} className="p-1 text-muted hover:text-fg-soft"><ArrowDown size={12} /></button>}
          {onResize && <button onClick={() => onResize(3)} className="p-1 text-muted hover:text-fg-soft" title="Powiększ"><Maximize2 size={12} /></button>}
          {onResize && <button onClick={() => onResize(-3)} className="p-1 text-muted hover:text-fg-soft" title="Zmniejsz"><Minimize2 size={12} /></button>}
          <button onClick={onRemove} className="p-1 text-muted hover:text-danger"><X size={12} /></button>
        </div>
      </div>

      {/* Debug panel */}
      {showDebug && data?.debug && (
        <div className="px-3 py-2 border-b border-line bg-bg text-[10px] font-mono text-muted space-y-0.5 max-h-32 overflow-auto">
          <div><span className="text-fg-soft">widget:</span> {widgetType}</div>
          <div><span className="text-fg-soft">zakres:</span> {data.debug.dateFrom} — {data.debug.dateTo}</div>
          <div><span className="text-fg-soft">sklep:</span> {data.debug.shop}</div>
          {data.debug.ordersInRange != null && <div><span className="text-fg-soft">zamówień w zakresie:</span> {data.debug.ordersInRange}</div>}
          {data.debug.itemsFound != null && <div><span className="text-fg-soft">pozycji znalezionych:</span> {data.debug.itemsFound}</div>}
          {data.debug.debugQuery && <div><span className="text-fg-soft">zapytanie:</span> {data.debug.debugQuery}</div>}
          {data.debug.query && <div><span className="text-fg-soft">zapytanie:</span> {data.debug.query}</div>}
          {data.debug.crossFilters?.length > 0 && <div><span className="text-fg-soft">cross-filtry:</span> {data.debug.crossFilters.join(', ')}</div>}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 p-3 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <RefreshCw size={18} className="animate-spin text-muted" />
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-xs text-danger">{error}</div>
        ) : data ? (
          <WidgetContent type={widgetType} data={data} onItemClick={handleItemClick} activeValues={activeValues} prevValue={prevValue} />
        ) : null}
      </div>
    </div>
  );
}

function WidgetContent({ type, data, onItemClick, activeValues, prevValue }: {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  onItemClick: (name: string) => void;
  activeValues: Set<string>;
  prevValue: number | null;
}) {
  const clickable = !!WIDGET_CLICK_FIELD[type];

  // Pivot
  if (data.type === 'pivot') {
    return <PivotRenderer data={data.pivot} />;
  }

  // KPI
  if (data.type === 'kpi') {
    const cur = data.currency || 'PLN';
    const formatted = data.format === 'currency' ? formatCurrency(data.value, cur)
      : data.format === 'percent' ? `${data.value.toFixed(1)}%`
      : data.format === 'mer' ? `${data.value.toFixed(2)}x`
      : formatNumber(data.value);
    // Zmiana vs poprzedni okres — pokazujemy gdy mamy prev i abs >= 0.1%.
    const change = (typeof prevValue === 'number' && prevValue !== 0)
      ? ((Number(data.value) - prevValue) / Math.abs(prevValue)) * 100
      : null;
    const showChange = change !== null && Math.abs(change) >= 0.1;
    const positive = (change ?? 0) >= 0;
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2">
        <div className="text-3xl font-bold text-fg">{formatted}</div>
        {showChange && (
          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-pill ${
            positive ? 'bg-green-100 text-success' : 'bg-rose-100 text-danger'
          }`}>
            {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {positive ? '+' : ''}{change!.toFixed(1)}%
            <span className="opacity-60 ml-0.5 font-normal">vs poprz.</span>
          </span>
        )}
      </div>
    );
  }

  // Ranking
  if (data.type === 'ranking') {
    const items: Array<{ name: string; value: number }> = data.data || [];
    const maxVal = Math.max(...items.map(i => i.value), 1);
    const isCurrency = data.format === 'currency';
    const cur = data.currency || 'PLN';
    return (
      <div className="h-full overflow-y-auto">
        <table className="w-full text-xs">
          <tbody>
            {items.map((item, i) => {
              const isActive = activeValues.has(String(item.name).toLowerCase());
              return (
              <tr
                key={i}
                className={`border-b border-line ${clickable ? 'cursor-pointer hover:bg-bg' : ''} ${isActive ? 'bg-primary-600/20 hover:bg-primary-600/30' : ''}`}
                onClick={() => clickable && onItemClick(item.name)}
              >
                <td className="py-1.5 pr-2 text-muted w-6">{i + 1}.</td>
                <td className="py-1.5 text-fg-soft truncate max-w-[150px]">{item.name}</td>
                <td className="py-1.5 px-2 text-right text-fg-soft w-16 whitespace-nowrap">
                  {isCurrency ? formatCurrency(item.value, cur) : formatNumber(item.value)}
                </td>
                <td className="py-1.5 w-24">
                  <div className="h-3 bg-bg rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(item.value / maxVal) * 100}%` }} />
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {data.total != null && (
          <div className="text-xs text-muted mt-2 text-right">
            Suma: {isCurrency ? formatCurrency(data.total, cur) : formatNumber(data.total)}
          </div>
        )}
      </div>
    );
  }

  // Bar chart
  if (data.type === 'bar') {
    return <SimpleBarChart data={data.data || []} barColor="#9333EA" height={200} />;
  }

  // Line chart
  if (data.type === 'line') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data.data || []} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#EAEBE8" />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8B908C' }} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#8B908C' }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #ECEDEB', borderRadius: '8px', fontSize: '11px' }} />
          <Line type="monotone" dataKey="value" stroke="#9333EA" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // Area chart (revenue timeline with shops)
  if (data.type === 'area') {
    const shops: string[] = data.shops || [];
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data.data || []} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#EAEBE8" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#8B908C' }} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#8B908C' }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #ECEDEB', borderRadius: '8px', fontSize: '11px' }} />
          <Legend wrapperStyle={{ fontSize: '10px' }} iconType="circle" iconSize={6} />
          {shops.map(s => (
            <Area key={s} type="monotone" dataKey={s} stackId="stack" stroke={SHOP_COLORS[s] || '#6b7280'} fill={SHOP_COLORS[s] || '#6b7280'} fillOpacity={0.6} strokeWidth={2} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  // Pie chart
  if (data.type === 'pie') {
    return <SimplePieChart data={data.data || []} height={200} innerRadius={40} />;
  }

  // Table
  if (data.type === 'table') {
    const rows = data.dataRows || data.data || [];
    return (
      <div className="overflow-auto text-xs">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              {(data.columns || []).map((col: string) => (
                <th key={col} className="py-2 px-2 text-left text-fg-soft font-medium">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row: Record<string, unknown>, i: number) => (
              <tr key={i} className="border-b border-line">
                {(data.columns?.length
                  ? [row.x, ...(data.columns.slice(1).map((c: string) => row[c]))]
                  : Object.values(row)
                ).map((val: unknown, j: number) => (
                  <td key={j} className="py-1.5 px-2 text-fg-soft">
                    {typeof val === 'number' ? formatNumber(val) : String(val)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return <div className="text-muted text-xs">Brak danych</div>;
}
