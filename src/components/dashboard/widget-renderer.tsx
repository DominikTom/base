'use client';

import { useEffect, useState } from 'react';
import { useDashboard } from '@/lib/dashboard-context';
import { getWidgetDef } from '@/lib/widget-definitions';
import { formatCurrency, formatNumber, SHOP_COLORS } from '@/lib/utils';
import { SimpleBarChart } from '@/components/charts/bar-chart';
import { SimplePieChart } from '@/components/charts/pie-chart';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { X, RefreshCw, ArrowUp, ArrowDown, Maximize2, Minimize2, HelpCircle } from 'lucide-react';

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

  useEffect(() => {
    let cancelled = false;
    async function fetch_() {
      setLoading(true);
      setError(null);
      try {
        const res = widgetType === 'custom_explorer'
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
              limit: 20,
              crossFilters,
            }),
          });
        if (!cancelled) {
          const json = await res.json();
          if (!res.ok) setError(json.error || 'Błąd');
          else if (widgetType === 'custom_explorer') {
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

  const handleItemClick = (name: string) => {
    const field = WIDGET_CLICK_FIELD[widgetType];
    if (!field) return;
    addCrossFilter({
      field,
      value: name,
      label: `${FIELD_LABELS[field] || field}: ${name}`,
    });
  };

  if (!def) return <div className="p-4 text-red-400">Nieznany widget: {widgetType}</div>;

  return (
    <div className="h-full flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/50 shrink-0">
        <span className="text-xs font-medium text-zinc-400 truncate">{String(widgetConfig?.title || def.name)}</span>
        <div className="flex items-center gap-0.5">
          <button onClick={() => setShowDebug(d => !d)} className={`p-1 ${showDebug ? 'text-blue-400' : 'text-zinc-600'} hover:text-blue-300`} title="Debug info"><HelpCircle size={12} /></button>
          {onMoveUp && <button onClick={onMoveUp} className="p-1 text-zinc-600 hover:text-zinc-300"><ArrowUp size={12} /></button>}
          {onMoveDown && <button onClick={onMoveDown} className="p-1 text-zinc-600 hover:text-zinc-300"><ArrowDown size={12} /></button>}
          {onResize && <button onClick={() => onResize(3)} className="p-1 text-zinc-600 hover:text-zinc-300"><Maximize2 size={12} /></button>}
          {onResize && <button onClick={() => onResize(-3)} className="p-1 text-zinc-600 hover:text-zinc-300"><Minimize2 size={12} /></button>}
          <button onClick={onRemove} className="p-1 text-zinc-600 hover:text-red-400"><X size={12} /></button>
        </div>
      </div>

      {/* Debug panel */}
      {showDebug && data?.debug && (
        <div className="px-3 py-2 border-b border-zinc-800/50 bg-zinc-950 text-[10px] font-mono text-zinc-500 space-y-0.5 max-h-32 overflow-auto">
          <div><span className="text-zinc-400">widget:</span> {widgetType}</div>
          <div><span className="text-zinc-400">zakres:</span> {data.debug.dateFrom} — {data.debug.dateTo}</div>
          <div><span className="text-zinc-400">sklep:</span> {data.debug.shop}</div>
          {data.debug.ordersInRange != null && <div><span className="text-zinc-400">zamówień w zakresie:</span> {data.debug.ordersInRange}</div>}
          {data.debug.itemsFound != null && <div><span className="text-zinc-400">pozycji znalezionych:</span> {data.debug.itemsFound}</div>}
          {data.debug.debugQuery && <div><span className="text-zinc-400">zapytanie:</span> {data.debug.debugQuery}</div>}
          {data.debug.query && <div><span className="text-zinc-400">zapytanie:</span> {data.debug.query}</div>}
          {data.debug.crossFilters?.length > 0 && <div><span className="text-zinc-400">cross-filtry:</span> {data.debug.crossFilters.join(', ')}</div>}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 p-3 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <RefreshCw size={18} className="animate-spin text-zinc-600" />
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-xs text-red-400">{error}</div>
        ) : data ? (
          <WidgetContent type={widgetType} data={data} onItemClick={handleItemClick} />
        ) : null}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function WidgetContent({ type, data, onItemClick }: { type: string; data: any; onItemClick: (name: string) => void }) {
  const clickable = !!WIDGET_CLICK_FIELD[type];

  // KPI
  if (data.type === 'kpi') {
    const cur = data.currency || 'PLN';
    const formatted = data.format === 'currency' ? formatCurrency(data.value, cur)
      : data.format === 'percent' ? `${data.value.toFixed(1)}%`
      : data.format === 'mer' ? `${data.value.toFixed(2)}x`
      : formatNumber(data.value);
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <div className="text-3xl font-bold text-zinc-100">{formatted}</div>
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
            {items.map((item, i) => (
              <tr
                key={i}
                className={`border-b border-zinc-800/30 ${clickable ? 'cursor-pointer hover:bg-zinc-800/50' : ''}`}
                onClick={() => clickable && onItemClick(item.name)}
              >
                <td className="py-1.5 pr-2 text-zinc-500 w-6">{i + 1}.</td>
                <td className="py-1.5 text-zinc-300 truncate max-w-[150px]">{item.name}</td>
                <td className="py-1.5 px-2 text-right text-zinc-400 w-16 whitespace-nowrap">
                  {isCurrency ? formatCurrency(item.value, cur) : formatNumber(item.value)}
                </td>
                <td className="py-1.5 w-24">
                  <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(item.value / maxVal) * 100}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.total != null && (
          <div className="text-xs text-zinc-500 mt-2 text-right">
            Suma: {isCurrency ? formatCurrency(data.total, cur) : formatNumber(data.total)}
          </div>
        )}
      </div>
    );
  }

  // Bar chart
  if (data.type === 'bar') {
    return <SimpleBarChart data={data.data || []} barColor="#3b82f6" height={200} />;
  }

  // Line chart
  if (data.type === 'line') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data.data || []} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717a' }} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#71717a' }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', fontSize: '11px' }} />
          <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} />
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
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#71717a' }} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#71717a' }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', fontSize: '11px' }} />
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
            <tr className="border-b border-zinc-700">
              {(data.columns || []).map((col: string) => (
                <th key={col} className="py-2 px-2 text-left text-zinc-400 font-medium">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row: Record<string, unknown>, i: number) => (
              <tr key={i} className="border-b border-zinc-800/30">
                {(data.columns?.length
                  ? [row.x, ...(data.columns.slice(1).map((c: string) => row[c]))]
                  : Object.values(row)
                ).map((val: unknown, j: number) => (
                  <td key={j} className="py-1.5 px-2 text-zinc-300">
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

  return <div className="text-zinc-500 text-xs">Brak danych</div>;
}
