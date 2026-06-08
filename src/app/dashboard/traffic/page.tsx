'use client';

import { useEffect, useState } from 'react';
import { useDashboard } from '@/lib/dashboard-context';
import { KpiCard } from '@/components/ui/kpi-card';
import { ChartCard } from '@/components/charts/chart-card';
import { SimplePieChart } from '@/components/charts/pie-chart';
import { SimpleBarChart } from '@/components/charts/bar-chart';
import { DataTable, type Column } from '@/components/ui/data-table';
import { formatNumber, formatCurrency, SHOP_COLORS } from '@/lib/utils';
import { previousPeriod, pctChange, COMPARE_LABEL } from '@/lib/period-compare';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Users, Globe, MousePointerClick, ShoppingCart, Eye, TrendingUp, RefreshCw, CheckCircle, XCircle, DollarSign, MousePointer } from 'lucide-react';

interface TrafficData {
  kpis: {
    sessions: number;
    users: number;
    newUsers: number;
    pageviews: number;
    transactions: number;
    revenue: number;
    adCost: number;
    adClicks: number;
    adImpressions: number;
    conversionRate: number;
  };
  charts: {
    sessionsTimeSeries: Array<Record<string, string | number>>;
    sourcePie: Array<{ name: string; value: number }>;
    adCostDaily: Array<{ name: string; value: number }>;
    revDaily: Array<{ name: string; value: number }>;
  };
  sourceTable: Array<{
    source: string;
    sessions: number;
    transactions: number;
    revenue: number;
    conversionRate: number;
  }>;
  hostnames: string[];
  dataInfo: {
    totalRowsInDb: number;
    detailRowsInDb: number;
    oldestDate: string | null;
    newestDate: string | null;
  };
}

export default function TrafficPage() {
  const { filters } = useDashboard();
  const [data, setData] = useState<TrafficData | null>(null);
  const [prevKpis, setPrevKpis] = useState<TrafficData['kpis'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/etl/ga4-sync', { method: 'POST' });
      const json = await res.json();
      if (res.ok) {
        setSyncResult({ ok: true, message: `Pobrano ${json.totalRows} wierszy z GA4` });
        // Re-fetch data
        const params = new URLSearchParams({ date_from: filters.dateFrom, date_to: filters.dateTo, hostname: hostnameFilter });
        const dataRes = await fetch(`/api/dashboard/traffic?${params}`);
        setData(await dataRes.json());
      } else {
        setSyncResult({ ok: false, message: json.error || 'Błąd synchronizacji' });
      }
    } catch (err) {
      setSyncResult({ ok: false, message: String(err) });
    } finally {
      setSyncing(false);
    }
  }

  // Map shop filter to hostname for GA4
  const shopToHostname: Record<string, string> = {
    'mybed.pl': 'mybed.pl',
    'mybed.de': 'mybed.de',
    'mittohome.pl': 'mittohome.pl',
  };
  const hostnameFilter = filters.shop === 'all'
    ? 'all'
    : (shopToHostname[filters.shop] || '__none__');

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const prev = previousPeriod(filters.dateFrom, filters.dateTo);
        const mk = (df: string, dt: string) => new URLSearchParams({ date_from: df, date_to: dt, hostname: hostnameFilter });
        const [curRes, prevRes] = await Promise.all([
          fetch(`/api/dashboard/traffic?${mk(filters.dateFrom, filters.dateTo)}`),
          fetch(`/api/dashboard/traffic?${mk(prev.from, prev.to)}`),
        ]);
        const cur = await curRes.json();
        const prv = prevRes.ok ? await prevRes.json() : null;
        setData(cur);
        setPrevKpis(prv?.kpis ?? null);
      } catch {
        setData(null); setPrevKpis(null);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [filters, hostnameFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-pulse text-muted">Ładowanie danych...</div>
      </div>
    );
  }

  if (!data || (data.kpis.sessions === 0 && data.kpis.users === 0)) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-fg">Ruch (GA4)</h1>
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 btn-primary-gradient text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
            {syncing ? <RefreshCw size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {syncing ? 'Synchronizacja...' : 'Sync GA4'}
          </button>
        </div>
        {syncResult && (
          <div className={`rounded-lg p-3 flex items-center gap-2 text-sm ${syncResult.ok ? 'bg-emerald-900/20 border border-emerald-800 text-emerald-400' : 'bg-red-900/20 border border-red-200 text-danger'}`}>
            {syncResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
            {syncResult.message}
          </div>
        )}
        <div className="flex flex-col items-center justify-center h-72 gap-4 border-2 border-dashed border-line rounded-xl">
          <p className="text-muted">Brak danych GA4. Kliknij "Sync GA4" żeby pobrać dane z Google Analytics.</p>
        </div>
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-fg">Ruch (GA4)</h1>
        <button onClick={handleSync} disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 bg-bg hover:bg-line text-fg text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
          {syncing ? <RefreshCw size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {syncing ? 'Synchronizacja...' : 'Sync GA4'}
        </button>
      </div>
      {syncResult && (
        <div className={`rounded-lg p-3 flex items-center gap-2 text-sm ${syncResult.ok ? 'bg-emerald-900/20 border border-emerald-800 text-emerald-400' : 'bg-red-900/20 border border-red-200 text-danger'}`}>
          {syncResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
          {syncResult.message}
        </div>
      )}

      {/* Data range info */}
      {data.dataInfo?.oldestDate && (
        <div className="text-xs text-muted flex items-center gap-4">
          <span>Dane GA4 w bazie: <span className="text-fg-soft">{data.dataInfo.oldestDate}</span> — <span className="text-fg-soft">{data.dataInfo.newestDate}</span></span>
          <span>({data.dataInfo.totalRowsInDb} dni, {data.dataInfo.detailRowsInDb} wierszy detail)</span>
        </div>
      )}

      {/* Active filter label */}
      {hostnameFilter !== 'all' && hostnameFilter !== '__none__' && (
        <div className="text-sm text-fg-soft">
          Dane dla: <span className="text-fg font-medium">{hostnameFilter}</span>
        </div>
      )}
      {hostnameFilter === '__none__' && (
        <div className="text-sm text-amber-400">
          Brak mapowania sklepu <span className="font-medium">{filters.shop}</span> do GA4 hostname.
        </div>
      )}

      {/* KPIs — Traffic */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <KpiCard title="Sesje" value={formatNumber(data.kpis.sessions)} icon={<Globe size={18} />}
          change={pctChange(data.kpis.sessions, prevKpis?.sessions)} changeLabel={COMPARE_LABEL} />
        <KpiCard title="Użytkownicy" value={formatNumber(data.kpis.users)} icon={<Users size={18} />}
          change={pctChange(data.kpis.users, prevKpis?.users)} changeLabel={COMPARE_LABEL} />
        <KpiCard title="Nowi użytkownicy" value={formatNumber(data.kpis.newUsers)} icon={<Users size={18} />}
          change={pctChange(data.kpis.newUsers, prevKpis?.newUsers)} changeLabel={COMPARE_LABEL} />
        <KpiCard title="Odsłony" value={formatNumber(data.kpis.pageviews)} icon={<Eye size={18} />}
          change={pctChange(data.kpis.pageviews, prevKpis?.pageviews)} changeLabel={COMPARE_LABEL} />
        <KpiCard title="Conv. Rate" value={`${data.kpis.conversionRate}%`} icon={<TrendingUp size={18} />}
          change={pctChange(data.kpis.conversionRate, prevKpis?.conversionRate)} changeLabel={COMPARE_LABEL} />
      </div>

      {/* KPIs — Revenue & Ads */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <KpiCard title="Revenue (GA4)" value={formatCurrency(data.kpis.revenue)} icon={<DollarSign size={18} />}
          change={pctChange(data.kpis.revenue, prevKpis?.revenue)} changeLabel={COMPARE_LABEL} />
        <KpiCard title="Transakcje (GA4)" value={formatNumber(data.kpis.transactions)} icon={<ShoppingCart size={18} />}
          change={pctChange(data.kpis.transactions, prevKpis?.transactions)} changeLabel={COMPARE_LABEL} />
        <KpiCard title="Google Ads Spend" value={formatCurrency(data.kpis.adCost)} icon={<DollarSign size={18} />}
          change={pctChange(data.kpis.adCost, prevKpis?.adCost)} changeLabel={COMPARE_LABEL} />
        <KpiCard title="Ads Clicks" value={formatNumber(data.kpis.adClicks)} icon={<MousePointer size={18} />}
          change={pctChange(data.kpis.adClicks, prevKpis?.adClicks)} changeLabel={COMPARE_LABEL} />
        <KpiCard title="Ads Impressions" value={formatNumber(data.kpis.adImpressions)} icon={<Eye size={18} />}
          change={pctChange(data.kpis.adImpressions, prevKpis?.adImpressions)} changeLabel={COMPARE_LABEL} />
      </div>

      {/* Sessions over time */}
      {/* Google Ads charts — like agency dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Google Ads — Koszt" subtitle={`Total: ${formatCurrency(data.kpis.adCost)}`}>
          <SimpleBarChart data={data.charts.adCostDaily} barColor="#9333EA" valueFormatter={v => formatCurrency(v)} />
        </ChartCard>
        <ChartCard title="Revenue (GA4)" subtitle={`Total: ${formatCurrency(data.kpis.revenue)}`}>
          <SimpleBarChart data={data.charts.revDaily} barColor="#16A34A" valueFormatter={v => formatCurrency(v)} />
        </ChartCard>
      </div>

      <ChartCard title="Sesje w czasie" subtitle="Podział na hostname">
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={data.charts.sessionsTimeSeries} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EAEBE8" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8B908C' }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#8B908C' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #ECEDEB', borderRadius: '8px', fontSize: '12px' }} />
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
