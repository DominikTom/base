'use client';

import { useEffect, useState } from 'react';
import { useDashboard } from '@/lib/dashboard-context';
import { ChartCard } from '@/components/charts/chart-card';
import { SimpleBarChart } from '@/components/charts/bar-chart';
import { SimplePieChart } from '@/components/charts/pie-chart';
import { RevenueChart } from '@/components/charts/revenue-chart';
import { DataTable, type Column } from '@/components/ui/data-table';
import { formatNumber, formatCurrency, SHOP_COLORS } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, AreaChart, Area, LineChart, Line } from 'recharts';

const X_AXIS_OPTIONS = [
  { value: 'date', label: 'Data' },
  { value: 'source_shop', label: 'Sklep' },
  { value: 'product_category', label: 'Kategoria produktu' },
  { value: 'supplier', label: 'Dostawca' },
  { value: 'source_platform', label: 'Platforma' },
];

const Y_AXIS_OPTIONS = [
  { value: 'revenue_gross', label: 'Revenue (brutto)' },
  { value: 'orders_count', label: 'Liczba zamówień' },
  { value: 'avg_order_value', label: 'Średnia wartość zamówienia' },
];

const GROUP_BY_OPTIONS = [
  { value: '', label: 'Brak grupowania' },
  { value: 'source_shop', label: 'Sklep' },
  { value: 'product_category', label: 'Kategoria' },
  { value: 'supplier', label: 'Dostawca' },
  { value: 'source_platform', label: 'Platforma' },
];

const CHART_TYPES = [
  { value: 'bar', label: 'Słupkowy' },
  { value: 'line', label: 'Liniowy' },
  { value: 'area', label: 'Warstwowy' },
  { value: 'pie', label: 'Kołowy' },
  { value: 'table', label: 'Tabela' },
];

const GRANULARITY_OPTIONS = [
  { value: 'day', label: 'Dzień' },
  { value: 'week', label: 'Tydzień' },
  { value: 'month', label: 'Miesiąc' },
  { value: 'quarter', label: 'Kwartał' },
];

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#f97316', '#06b6d4', '#ec4899', '#84cc16', '#14b8a6'];

interface ExplorerResult {
  data: Array<Record<string, string | number>>;
  groups: string[];
  meta: { total_rows: number; date_range: { from: string; to: string } };
}

export default function ExplorerPage() {
  const { filters } = useDashboard();
  const [xAxis, setXAxis] = useState('date');
  const [yAxis, setYAxis] = useState('revenue_gross');
  const [groupBy, setGroupBy] = useState('');
  const [chartType, setChartType] = useState('bar');
  const [granularity, setGranularity] = useState('month');
  const [result, setResult] = useState<ExplorerResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function runQuery() {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/explorer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          x_axis: xAxis,
          y_axis: yAxis,
          group_by: groupBy || undefined,
          date_from: filters.dateFrom,
          date_to: filters.dateTo,
          filters: { shop: filters.shop !== 'all' ? [filters.shop] : [] },
          granularity,
        }),
      });
      const json = await res.json();
      setResult(json);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runQuery();
  }, [filters.dateFrom, filters.dateTo, filters.shop]);

  const selClass = 'px-3 py-2 text-sm rounded-lg bg-surface border border-line text-fg focus:outline-none focus:ring-2 focus:ring-primary-400';

  function renderChart() {
    if (!result || !result.data.length) {
      return <div className="flex items-center justify-center h-64 text-muted">Brak danych dla wybranych parametrów</div>;
    }

    const groups = result.groups;

    if (chartType === 'table') {
      const columns: Column<Record<string, string | number>>[] = [
        { key: 'x', header: xAxis === 'date' ? 'Data' : xAxis, accessor: r => r.x },
        ...groups.map(g => ({
          key: g,
          header: g,
          accessor: (r: Record<string, string | number>) => r[g] || 0,
          align: 'right' as const,
          format: (v: string | number) => yAxis === 'revenue_gross' || yAxis === 'avg_order_value'
            ? formatCurrency(v as number)
            : formatNumber(v as number),
        })),
      ];
      return <DataTable data={result.data} columns={columns} pageSize={20} />;
    }

    if (chartType === 'pie') {
      const pieData = groups.length === 1
        ? result.data.map(d => ({ name: String(d.x), value: d[groups[0]] as number }))
        : result.data.slice(0, 1).length
          ? groups.map(g => ({ name: g, value: result.data.reduce((s, d) => s + ((d[g] as number) || 0), 0) }))
          : [];
      return <SimplePieChart data={pieData} height={400} />;
    }

    if (chartType === 'line') {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={result.data} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EAEBE8" />
            <XAxis dataKey="x" tick={{ fontSize: 11, fill: '#8B908C' }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#8B908C' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #ECEDEB', borderRadius: '8px', fontSize: '12px' }} />
            <Legend />
            {groups.map((g, i) => (
              <Line key={g} type="monotone" dataKey={g} name={g} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === 'area') {
      return (
        <ResponsiveContainer width="100%" height={400}>
          <AreaChart data={result.data} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EAEBE8" />
            <XAxis dataKey="x" tick={{ fontSize: 11, fill: '#8B908C' }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#8B908C' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #ECEDEB', borderRadius: '8px', fontSize: '12px' }} />
            <Legend />
            {groups.map((g, i) => (
              <Area key={g} type="monotone" dataKey={g} name={g} stackId="stack" stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.6} strokeWidth={2} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      );
    }

    // Default: bar chart
    return (
      <ResponsiveContainer width="100%" height={400}>
        <BarChart data={result.data} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#EAEBE8" />
          <XAxis dataKey="x" tick={{ fontSize: 11, fill: '#8B908C' }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#8B908C' }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #ECEDEB', borderRadius: '8px', fontSize: '12px' }} />
          <Legend />
          {groups.map((g, i) => (
            <Bar key={g} dataKey={g} name={g} stackId={groupBy ? 'stack' : undefined} fill={COLORS[i % COLORS.length]} radius={[2, 2, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-fg">Eksplorator danych</h1>

      {/* Config panel */}
      <div className="flex flex-wrap items-end gap-4 p-4 rounded-xl border border-line bg-surface">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Oś X</label>
          <select value={xAxis} onChange={e => setXAxis(e.target.value)} className={selClass}>
            {X_AXIS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Oś Y</label>
          <select value={yAxis} onChange={e => setYAxis(e.target.value)} className={selClass}>
            {Y_AXIS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Grupowanie</label>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)} className={selClass}>
            {GROUP_BY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Typ wykresu</label>
          <select value={chartType} onChange={e => setChartType(e.target.value)} className={selClass}>
            {CHART_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Granulacja</label>
          <select value={granularity} onChange={e => setGranularity(e.target.value)} className={selClass}>
            {GRANULARITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <button
          onClick={runQuery}
          disabled={loading}
          className="px-5 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? 'Ładowanie...' : 'Uruchom'}
        </button>
      </div>

      {/* Chart area */}
      <ChartCard
        title="Wynik"
        subtitle={result ? `${result.meta.total_rows} wierszy` : undefined}
      >
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-pulse text-muted">Ładowanie...</div>
          </div>
        ) : (
          renderChart()
        )}
      </ChartCard>
    </div>
  );
}
