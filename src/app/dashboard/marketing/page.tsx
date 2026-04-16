'use client';

import { useEffect, useState } from 'react';
import { useDashboard } from '@/lib/dashboard-context';
import { KpiCard } from '@/components/ui/kpi-card';
import { ChartCard } from '@/components/charts/chart-card';
import { SimpleBarChart } from '@/components/charts/bar-chart';
import { SimplePieChart } from '@/components/charts/pie-chart';
import { DataTable, type Column } from '@/components/ui/data-table';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { DollarSign, Target, TrendingUp, MousePointerClick, Eye, Percent, RefreshCw, CheckCircle, XCircle } from 'lucide-react';

interface MarketingData {
  kpis: {
    totalSpend: number;
    totalConversions: number;
    blendedRoas: number;
    avgCpc: number;
    avgCpm: number;
    avgCtr: number;
  };
  charts: {
    spendVsRevenue: Array<{ date: string; spend: number; revenue: number }>;
    roasTrend: Array<{ name: string; value: number }>;
    spendByPlatform: Array<{ name: string; value: number }>;
    topByRoas: Array<{ name: string; value: number }>;
  };
  campaignTable: Array<{
    campaign_id: string;
    campaign_name: string;
    platform: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    conversion_value: number;
    ctr: number;
    cpc: number;
    roas: number;
  }>;
}

export default function MarketingPage() {
  const { filters } = useDashboard();
  const [data, setData] = useState<MarketingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          date_from: filters.dateFrom,
          date_to: filters.dateTo,
        });
        const res = await fetch(`/api/dashboard/marketing?${params}`);
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
        <p className="text-zinc-500">Brak danych marketingowych. Dane zostaną załadowane z Meta/Pinterest API.</p>
      </div>
    );
  }

  const campaignColumns: Column<(typeof data.campaignTable)[0]>[] = [
    { key: 'campaign_name', header: 'Kampania', accessor: r => r.campaign_name, className: 'max-w-[250px] truncate' },
    { key: 'platform', header: 'Platforma', accessor: r => r.platform },
    { key: 'spend', header: 'Spend', accessor: r => r.spend, align: 'right', format: v => formatCurrency(v as number) },
    { key: 'impressions', header: 'Impressions', accessor: r => r.impressions, align: 'right', format: v => formatNumber(v as number) },
    { key: 'clicks', header: 'Clicks', accessor: r => r.clicks, align: 'right', format: v => formatNumber(v as number) },
    { key: 'ctr', header: 'CTR', accessor: r => r.ctr, align: 'right', format: v => `${(v as number).toFixed(2)}%` },
    { key: 'cpc', header: 'CPC', accessor: r => r.cpc, align: 'right', format: v => `${(v as number).toFixed(2)} zł` },
    { key: 'conversions', header: 'Conv.', accessor: r => r.conversions, align: 'right' },
    { key: 'conversion_value', header: 'Revenue', accessor: r => r.conversion_value, align: 'right', format: v => formatCurrency(v as number) },
    {
      key: 'roas', header: 'ROAS', accessor: r => r.roas, align: 'right',
      format: v => `${(v as number).toFixed(2)}x`,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">Marketing Performance</h1>
        <SyncMetaButton />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard title="Total Spend" value={formatCurrency(data.kpis.totalSpend)} icon={<DollarSign size={18} />} />
        <KpiCard title="Konwersje" value={formatNumber(data.kpis.totalConversions)} icon={<Target size={18} />} />
        <KpiCard title="Blended ROAS" value={`${data.kpis.blendedRoas}x`} icon={<TrendingUp size={18} />} />
        <KpiCard title="Avg CPC" value={`${data.kpis.avgCpc.toFixed(2)} zł`} icon={<MousePointerClick size={18} />} />
        <KpiCard title="Avg CPM" value={`${data.kpis.avgCpm.toFixed(2)} zł`} icon={<Eye size={18} />} />
        <KpiCard title="Avg CTR" value={`${data.kpis.avgCtr.toFixed(2)}%`} icon={<Percent size={18} />} />
      </div>

      {/* Spend vs Revenue */}
      <ChartCard title="Spend vs Revenue" subtitle="Dual-axis line chart">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data.charts.spendVsRevenue} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', fontSize: '12px' }} />
            <Legend />
            <Line yAxisId="left" type="monotone" dataKey="spend" name="Spend" stroke="#ef4444" strokeWidth={2} dot={false} />
            <Line yAxisId="right" type="monotone" dataKey="revenue" name="Revenue" stroke="#10b981" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* ROAS trend + Spend by platform */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="ROAS Trend">
          <SimpleBarChart data={data.charts.roasTrend} barColor="#f59e0b" valueFormatter={v => `${v}x`} />
        </ChartCard>
        <ChartCard title="Spend wg platformy">
          <SimplePieChart data={data.charts.spendByPlatform} />
        </ChartCard>
      </div>

      {/* Top campaigns by ROAS */}
      <ChartCard title="Top 10 kampanii wg ROAS" subtitle="Min. spend 100 PLN">
        <SimpleBarChart
          data={data.charts.topByRoas}
          layout="horizontal"
          barColor="#10b981"
          valueFormatter={v => `${v}x`}
          height={360}
        />
      </ChartCard>

      {/* Campaign table */}
      <ChartCard title="Tabela kampanii">
        <DataTable data={data.campaignTable} columns={campaignColumns} pageSize={15} />
      </ChartCard>
    </div>
  );
}

function SyncMetaButton() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSync() {
    setSyncing(true);
    setResult(null);
    try {
      const res = await fetch('/api/etl/meta-sync', { method: 'POST' });
      const json = await res.json();
      if (res.ok) {
        setResult({ ok: true, message: `Meta Ads: pobrano ${json.totalRows} wierszy` });
      } else {
        setResult({ ok: false, message: json.error || 'Błąd synchronizacji' });
      }
    } catch (err) {
      setResult({ ok: false, message: String(err) });
    }
    setSyncing(false);
  }

  return (
    <div className="flex items-center gap-3">
      {result && (
        <span className={`text-xs flex items-center gap-1 ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {result.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
          {result.message}
        </span>
      )}
      <button onClick={handleSync} disabled={syncing}
        className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm rounded-lg transition-colors disabled:opacity-50">
        {syncing ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {syncing ? 'Sync...' : 'Sync Meta'}
      </button>
    </div>
  );
}
