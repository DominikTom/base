'use client';

import { useEffect, useState } from 'react';
import { useDashboard } from '@/lib/dashboard-context';
import { KpiCard } from '@/components/ui/kpi-card';
import { ChartCard } from '@/components/charts/chart-card';
import { SimplePieChart } from '@/components/charts/pie-chart';
import { DataTable, type Column } from '@/components/ui/data-table';
import { formatNumber, formatCurrency, SHOP_COLORS } from '@/lib/utils';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Users, Globe, MousePointerClick, ShoppingCart, Eye, TrendingUp } from 'lucide-react';

interface TrafficData {
  kpis: {
    sessions: number;
    users: number;
    newUsers: number;
    pageviews: number;
    transactions: number;
    revenue: number;
    conversionRate: number;
  };
  charts: {
    sessionsTimeSeries: Array<Record<string, string | number>>;
    sourcePie: Array<{ name: string; value: number }>;
  };
  sourceTable: Array<{
    source: string;
    sessions: number;
    transactions: number;
    revenue: number;
    conversionRate: number;
  }>;
  hostnames: string[];
}

export default function TrafficPage() {
  const { filters } = useDashboard();
  const [data, setData] = useState<TrafficData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          date_from: filters.dateFrom,
          date_to: filters.dateTo,
        });
        const res = await fetch(`/api/dashboard/traffic?${params}`);
        const json = await res.json();
        setData(json);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [filters]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-pulse text-zinc-500">Ładowanie danych...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <p className="text-zinc-500">Brak danych GA4. Dane zostaną załadowane z Google Analytics API.</p>
      </div>
    );
  }

  const sourceColumns: Column<(typeof data.sourceTable)[0]>[] = [
    { key: 'source', header: 'Source / Medium', accessor: r => r.source },
    { key: 'sessions', header: 'Sesje', accessor: r => r.sessions, align: 'right', format: v => formatNumber(v as number) },
    { key: 'transactions', header: 'Transakcje', accessor: r => r.transactions, align: 'right' },
    { key: 'revenue', header: 'Revenue', accessor: r => r.revenue, align: 'right', format: v => formatCurrency(v as number) },
    { key: 'conversionRate', header: 'Conv. Rate', accessor: r => r.conversionRate, align: 'right', format: v => `${v}%` },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-zinc-100">Ruch (GA4)</h1>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard title="Sesje" value={formatNumber(data.kpis.sessions)} icon={<Globe size={18} />} />
        <KpiCard title="Użytkownicy" value={formatNumber(data.kpis.users)} icon={<Users size={18} />} />
        <KpiCard title="Nowi użytkownicy" value={formatNumber(data.kpis.newUsers)} icon={<Users size={18} />} />
        <KpiCard title="Odsłony" value={formatNumber(data.kpis.pageviews)} icon={<Eye size={18} />} />
        <KpiCard title="Transakcje" value={formatNumber(data.kpis.transactions)} icon={<ShoppingCart size={18} />} />
        <KpiCard title="Conv. Rate" value={`${data.kpis.conversionRate}%`} icon={<TrendingUp size={18} />} />
      </div>

      {/* Sessions over time */}
      <ChartCard title="Sesje w czasie" subtitle="Podział na hostname">
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={data.charts.sessionsTimeSeries} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', fontSize: '12px' }} />
            <Legend />
            {data.hostnames.map((host, i) => (
              <Area
                key={host}
                type="monotone"
                dataKey={host}
                name={host}
                stackId="stack"
                stroke={Object.values(SHOP_COLORS)[i] || '#6b7280'}
                fill={Object.values(SHOP_COLORS)[i] || '#6b7280'}
                fillOpacity={0.6}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Source breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Źródła ruchu">
          <SimplePieChart data={data.charts.sourcePie} height={320} />
        </ChartCard>
        <ChartCard title="Source / Medium performance">
          <DataTable data={data.sourceTable} columns={sourceColumns} pageSize={10} />
        </ChartCard>
      </div>
    </div>
  );
}
