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
import {
  DollarSign, Target, TrendingUp, MousePointerClick, Eye, Percent,
  RefreshCw, CheckCircle, XCircle, ShoppingCart, Globe,
} from 'lucide-react';

interface MetaMarketingData {
  kpis: {
    totalSpend: number;
    totalSpendOriginal: number | null;
    originalCurrency: string | null;
    totalConversions: number;
    totalConversionValue: number;
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
  lastSync: { at: string; rows: number } | null;
  coverage: { meta: { from: string; to: string; rows: number } | null };
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

interface GoogleAdsData {
  kpis: {
    totalSpend: number;
    totalRevenue: number;
    totalTransactions: number;
    totalSessions: number;
    totalClicks: number;
    blendedRoas: number;
    avgCpc: number;
    avgCpm: number;
    avgCtr: number;
    convRate: number;
  };
  charts: {
    spendVsRevenue: Array<{ date: string; spend: number; revenue: number }>;
    roasTrend: Array<{ name: string; value: number }>;
    spendByShop: Array<{ name: string; value: number }>;
    topByRoas: Array<{ name: string; value: number }>;
  };
  campaignTable: Array<{
    campaign: string;
    hostname: string;
    spend: number;
    revenue: number;
    clicks: number;
    impressions: number;
    transactions: number;
    sessions: number;
    ctr: number;
    cpc: number;
    roas: number;
  }>;
  campaignSumSpend: number;
  coverage: { from: string; to: string; rows: number } | null;
  lastSync: { at: string; rows: number } | null;
}

type TabKey = 'meta' | 'google';

export default function MarketingPage() {
  const [tab, setTab] = useState<TabKey>('meta');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">Marketing Performance</h1>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-800">
        {([
          { key: 'meta' as const, label: 'Meta Ads', icon: <Target size={14} /> },
          { key: 'google' as const, label: 'Google Ads', icon: <Globe size={14} /> },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.key
                ? 'border-blue-500 text-zinc-100'
                : 'border-transparent text-zinc-500 hover:text-zinc-300',
            )}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === 'meta' ? <MetaTab /> : <GoogleAdsTab />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Meta Ads
// ─────────────────────────────────────────────────────────────────
function MetaTab() {
  const { filters } = useDashboard();
  const [data, setData] = useState<MetaMarketingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          date_from: filters.dateFrom,
          date_to: filters.dateTo,
          shop: filters.shop,
        });
        const res = await fetch(`/api/dashboard/marketing?${params}`);
        const json = await res.json();
        setData(json);
      } catch { setData(null); } finally { setLoading(false); }
    }
    fetchData();
  }, [filters]);

  if (loading) return <PanelLoading />;
  if (!data) return <PanelEmpty hint="Brak danych Meta Ads. Zsynchronizuj Meta API." />;

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
    { key: 'roas', header: 'ROAS', accessor: r => r.roas, align: 'right', format: v => `${(v as number).toFixed(2)}x` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          {data.coverage.meta && (
            <p className="text-xs text-zinc-500">
              Meta: <span className="text-zinc-400">{data.coverage.meta.from}</span>
              {' → '}
              <span className="text-zinc-400">{data.coverage.meta.to}</span>
              {' · '}
              {daysBetween(data.coverage.meta.from, data.coverage.meta.to)} dni
              {' · '}
              {formatNumber(data.coverage.meta.rows)} wierszy
            </p>
          )}
        </div>
        <SyncMetaButton lastSync={data.lastSync} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
        <KpiCard
          title="Total Spend"
          value={formatCurrency(data.kpis.totalSpend)}
          subLabel={data.kpis.totalSpendOriginal != null && data.kpis.originalCurrency
            ? `≈ ${formatNumber(data.kpis.totalSpendOriginal)} ${data.kpis.originalCurrency}`
            : undefined}
          icon={<DollarSign size={18} />}
        />
        <KpiCard
          title="Meta Revenue"
          value={formatCurrency(data.kpis.totalConversionValue)}
          subLabel="conversion_value (Meta-reported)"
          icon={<TrendingUp size={18} />}
        />
        <KpiCard title="Konwersje" value={formatNumber(data.kpis.totalConversions)} icon={<Target size={18} />} />
        <KpiCard title="Blended ROAS" value={`${data.kpis.blendedRoas}x`} icon={<TrendingUp size={18} />} />
        <KpiCard title="Avg CPC" value={`${data.kpis.avgCpc.toFixed(2)} zł`} icon={<MousePointerClick size={18} />} />
        <KpiCard title="Avg CPM" value={`${data.kpis.avgCpm.toFixed(2)} zł`} icon={<Eye size={18} />} />
        <KpiCard title="Avg CTR" value={`${data.kpis.avgCtr.toFixed(2)}%`} icon={<Percent size={18} />} />
      </div>

      <ChartCard title="Spend vs Revenue" subtitle="Dual-axis line chart">
        <SpendRevenueChart data={data.charts.spendVsRevenue} />
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="ROAS Trend">
          <SimpleBarChart data={data.charts.roasTrend} barColor="#f59e0b" valueFormatter={v => `${v}x`} />
        </ChartCard>
        <ChartCard title="Spend wg platformy">
          <SimplePieChart data={data.charts.spendByPlatform} />
        </ChartCard>
      </div>

      <ChartCard title="Top 10 kampanii wg ROAS" subtitle="Min. spend 100 PLN">
        <SimpleBarChart data={data.charts.topByRoas} layout="horizontal" barColor="#10b981" valueFormatter={v => `${v}x`} height={360} />
      </ChartCard>

      <ChartCard title="Tabela kampanii">
        <DataTable data={data.campaignTable} columns={campaignColumns} pageSize={15} />
      </ChartCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Google Ads
// ─────────────────────────────────────────────────────────────────
function GoogleAdsTab() {
  const { filters } = useDashboard();
  const [data, setData] = useState<GoogleAdsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          date_from: filters.dateFrom,
          date_to: filters.dateTo,
          shop: filters.shop,
        });
        const res = await fetch(`/api/dashboard/marketing/google?${params}`);
        const json = await res.json();
        setData(json);
      } catch { setData(null); } finally { setLoading(false); }
    }
    fetchData();
  }, [filters]);

  if (loading) return <PanelLoading />;
  if (!data) return <PanelEmpty hint="Brak danych Google Ads. Zsynchronizuj GA4." />;

  const campaignColumns: Column<(typeof data.campaignTable)[0]>[] = [
    { key: 'campaign', header: 'Kampania', accessor: r => r.campaign, className: 'max-w-[300px] truncate' },
    { key: 'hostname', header: 'Sklep', accessor: r => r.hostname },
    { key: 'spend', header: 'Spend', accessor: r => r.spend, align: 'right', format: v => formatCurrency(v as number) },
    { key: 'impressions', header: 'Impressions', accessor: r => r.impressions, align: 'right', format: v => formatNumber(v as number) },
    { key: 'clicks', header: 'Clicks', accessor: r => r.clicks, align: 'right', format: v => formatNumber(v as number) },
    { key: 'ctr', header: 'CTR', accessor: r => r.ctr, align: 'right', format: v => `${(v as number).toFixed(2)}%` },
    { key: 'cpc', header: 'CPC', accessor: r => r.cpc, align: 'right', format: v => `${(v as number).toFixed(2)} zł` },
    { key: 'sessions', header: 'Sesje', accessor: r => r.sessions, align: 'right', format: v => formatNumber(v as number) },
    { key: 'transactions', header: 'Trans.', accessor: r => r.transactions, align: 'right' },
    { key: 'revenue', header: 'Revenue', accessor: r => r.revenue, align: 'right', format: v => formatCurrency(v as number) },
    { key: 'roas', header: 'ROAS', accessor: r => r.roas, align: 'right', format: v => `${(v as number).toFixed(2)}x` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          {data.coverage && (
            <p className="text-xs text-zinc-500">
              Google Ads (GA4 per-kampania): <span className="text-zinc-400">{data.coverage.from}</span>
              {' → '}
              <span className="text-zinc-400">{data.coverage.to}</span>
              {' · '}
              {daysBetween(data.coverage.from, data.coverage.to)} dni
              {' · '}
              {formatNumber(data.coverage.rows)} wierszy
            </p>
          )}
          <p className="text-[11px] text-zinc-600 mt-0.5">
            Spend/clicks/impressions z GA4 __total__ (zgodne z widgetem „Google Ads Spend”;
            advertiserAdCost atrybutywne sesyjnie — typowo 1-3% mniej niż Google Ads UI).
            Revenue/transakcje/sesje z atrybucji source=google/medium=cpc. Dla mybed.de
            ad_cost i revenue konwertowane EUR→PLN dziennymi kursami z fact_orders.
          </p>
        </div>
        {data.lastSync && (
          <span className="text-xs text-zinc-500">
            GA4: {formatRelativeTime(data.lastSync.at)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
        <KpiCard title="Total Spend" value={formatCurrency(data.kpis.totalSpend)} icon={<DollarSign size={18} />} />
        <KpiCard
          title="Google Revenue"
          value={formatCurrency(data.kpis.totalRevenue)}
          subLabel="ga_revenue (GA4 last-click)"
          icon={<TrendingUp size={18} />}
        />
        <KpiCard title="Transakcje" value={formatNumber(data.kpis.totalTransactions)} icon={<ShoppingCart size={18} />} />
        <KpiCard title="Blended ROAS" value={`${data.kpis.blendedRoas}x`} icon={<TrendingUp size={18} />} />
        <KpiCard title="Avg CPC" value={`${data.kpis.avgCpc.toFixed(2)} zł`} icon={<MousePointerClick size={18} />} />
        <KpiCard title="Conv. Rate" value={`${data.kpis.convRate.toFixed(2)}%`} icon={<Percent size={18} />} />
        <KpiCard title="Avg CTR" value={`${data.kpis.avgCtr.toFixed(2)}%`} icon={<Eye size={18} />} />
      </div>

      <ChartCard title="Spend vs Revenue" subtitle="Dual-axis line chart">
        <SpendRevenueChart data={data.charts.spendVsRevenue} />
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="ROAS Trend">
          <SimpleBarChart data={data.charts.roasTrend} barColor="#f59e0b" valueFormatter={v => `${v}x`} />
        </ChartCard>
        <ChartCard title="Spend wg sklepu">
          <SimplePieChart data={data.charts.spendByShop} />
        </ChartCard>
      </div>

      <ChartCard title="Top 10 kampanii wg ROAS" subtitle="Min. spend 100 PLN">
        <SimpleBarChart data={data.charts.topByRoas} layout="horizontal" barColor="#10b981" valueFormatter={v => `${v}x`} height={360} />
      </ChartCard>

      <ChartCard
        title="Tabela kampanii Google Ads"
        subtitle={
          data.campaignSumSpend < data.kpis.totalSpend
            ? `Suma kampanii: ${formatCurrency(data.campaignSumSpend)} z ${formatCurrency(data.kpis.totalSpend)} (Total Spend). GA4 nie przypisuje wszystkich kliknięć do konkretnych kampanii — różnica ${formatCurrency(data.kpis.totalSpend - data.campaignSumSpend)} pochodzi z ruchu bez tagu utm_campaign.`
            : undefined
        }
      >
        <DataTable data={data.campaignTable} columns={campaignColumns} pageSize={15} />
      </ChartCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Wspólne pomocniki
// ─────────────────────────────────────────────────────────────────

function PanelLoading() {
  return (
    <div className="flex items-center justify-center h-96">
      <div className="animate-pulse text-zinc-500">Ładowanie danych...</div>
    </div>
  );
}

function PanelEmpty({ hint }: { hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-96 gap-4">
      <p className="text-zinc-500">{hint}</p>
    </div>
  );
}

function SpendRevenueChart({ data }: { data: Array<{ date: string; spend: number; revenue: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
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
  );
}

function daysBetween(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'przed chwilą';
  if (mins < 60) return `${mins} min temu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h temu`;
  const days = Math.floor(hours / 24);
  return `${days}d temu`;
}

const BACKFILL_OPTIONS = [
  { value: 7, label: '7 dni' },
  { value: 30, label: '30 dni' },
  { value: 90, label: '90 dni' },
  { value: 180, label: '180 dni' },
  { value: 365, label: '365 dni' },
  { value: 730, label: '2 lata' },
];

const CHUNK_DAYS = 90;
function buildBackfillChunks(daysBack: number): Array<{ since: string; until: string }> {
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const chunks: Array<{ since: string; until: string }> = [];
  const end = new Date();
  end.setDate(end.getDate() - 1);
  let remaining = daysBack;
  let until = new Date(end);
  while (remaining > 0) {
    const size = Math.min(remaining, CHUNK_DAYS);
    const since = new Date(until);
    since.setDate(since.getDate() - size + 1);
    chunks.push({ since: fmt(since), until: fmt(until) });
    remaining -= size;
    until = new Date(since);
    until.setDate(until.getDate() - 1);
  }
  return chunks;
}

async function parseJsonOrThrow(res: Response): Promise<{ totalRows?: number; error?: string }> {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch {
    throw new Error(res.status === 504 || text.startsWith('An error')
      ? 'Timeout Vercela (60s) — spróbuj mniejszego zakresu'
      : `Nieoczekiwana odpowiedź: ${text.slice(0, 80)}`);
  }
}

function SyncMetaButton({ lastSync }: { lastSync: { at: string; rows: number } | null }) {
  const [syncing, setSyncing] = useState(false);
  const [days, setDays] = useState(90);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSync() {
    setSyncing(true); setResult(null); setProgress(null);
    try {
      const chunks = buildBackfillChunks(days);
      let totalRows = 0;
      for (let i = 0; i < chunks.length; i++) {
        setProgress({ current: i + 1, total: chunks.length });
        const { since, until } = chunks[i];
        const res = await fetch(`/api/etl/meta-sync?since=${since}&until=${until}`, { method: 'POST' });
        const json = await parseJsonOrThrow(res);
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        totalRows += json.totalRows || 0;
      }
      setResult({ ok: true, message: `Meta Ads: pobrano ${totalRows} wierszy za ${days} dni` });
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSyncing(false); setProgress(null);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {progress ? (
        <span className="text-xs text-zinc-400 flex items-center gap-1">
          Chunk {progress.current}/{progress.total}…
        </span>
      ) : result ? (
        <span className={`text-xs flex items-center gap-1 ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {result.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
          {result.message}
        </span>
      ) : lastSync ? (
        <span className="text-xs text-zinc-500">Meta: {formatRelativeTime(lastSync.at)}</span>
      ) : null}
      <select
        value={days}
        onChange={e => setDays(parseInt(e.target.value, 10))}
        disabled={syncing}
        className="bg-zinc-800 text-zinc-200 text-sm rounded-lg px-2 py-2 border border-zinc-700 disabled:opacity-50"
      >
        {BACKFILL_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
      <button onClick={handleSync} disabled={syncing}
        className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm rounded-lg transition-colors disabled:opacity-50">
        {syncing ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {syncing ? 'Sync...' : 'Sync Meta'}
      </button>
    </div>
  );
}
