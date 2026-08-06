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
import type { AttributionWindow } from '@/lib/marketing-constants';
import type { AdsPayload } from '@/components/marketing/types';
import { AccountsSummary } from '@/components/marketing/accounts-summary';
import { CampaignsTab } from '@/components/marketing/campaigns-tab';
import { AdsetsTab } from '@/components/marketing/adsets-tab';
import { CreativesTab } from '@/components/marketing/creatives-tab';

interface MarketingData {
  kpis: {
    totalSpend: number;
    totalSpendOriginal: number | null;
    originalCurrency: string | null;
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
  lastSync: { at: string; rows: number } | null;
  coverage: {
    meta: { from: string; to: string; rows: number } | null;
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

type MarketingTab = 'przeglad' | 'konta' | 'kampanie' | 'zestawy' | 'kreacje';

const TABS: Array<{ id: MarketingTab; label: string }> = [
  { id: 'przeglad', label: 'Przegląd' },
  { id: 'konta', label: 'Konta & KPI' },
  { id: 'kampanie', label: 'Kampanie' },
  { id: 'zestawy', label: 'Zestawy reklam' },
  { id: 'kreacje', label: 'Kreacje' },
];

export default function MarketingPage() {
  const { filters } = useDashboard();
  const [tab, setTab] = useState<MarketingTab>('przeglad');

  // Przegląd (poziom kampanii, fact_daily_adspend) — jak dotychczas
  const [data, setData] = useState<MarketingData | null>(null);
  const [loading, setLoading] = useState(true);

  // Nowe zakładki (poziom reklam, fact_daily_ad_performance) — lazy fetch
  const [adsData, setAdsData] = useState<AdsPayload | null>(null);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsKey, setAdsKey] = useState('');
  const [attribution, setAttribution] = useState<AttributionWindow>('default');

  const filtersKey = `${filters.dateFrom}|${filters.dateTo}|${filters.shop}`;

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
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [filters]);

  // Dane ad-level dopiero po wejściu w nową zakładkę (rate limity Graph API
  // nie cierpią, bo to czysty odczyt z bazy — ale payload jest spory).
  useEffect(() => {
    if (tab === 'przeglad') return;
    if (adsData && adsKey === filtersKey) return;
    let cancelled = false;
    setAdsLoading(true);
    const params = new URLSearchParams({
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      shop: filters.shop,
    });
    fetch(`/api/dashboard/marketing/ads?${params}`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return;
        setAdsData(json.error ? null : json);
        setAdsKey(filtersKey);
      })
      .catch(() => { if (!cancelled) setAdsData(null); })
      .finally(() => { if (!cancelled) setAdsLoading(false); });
    return () => { cancelled = true; };
  }, [tab, filtersKey, adsData, adsKey, filters.dateFrom, filters.dateTo, filters.shop]);

  const handleCampaignMetaSaved = (
    campaignId: string,
    fields: { purpose: string | null; funnelStage: string | null; notes: string | null }
  ) => {
    setAdsData(prev => prev
      ? {
          ...prev,
          campaigns: prev.campaigns.map(c =>
            c.campaignId === campaignId ? { ...c, ...fields } : c
          ),
        }
      : prev);
  };

  const isOverview = tab === 'przeglad';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Marketing Performance</h1>
          {isOverview && data?.coverage.meta && (
            <p className="text-xs text-zinc-500 mt-1">
              Meta: <span className="text-zinc-400">{data.coverage.meta.from}</span>
              {' → '}
              <span className="text-zinc-400">{data.coverage.meta.to}</span>
              {' · '}
              {daysBetween(data.coverage.meta.from, data.coverage.meta.to)} dni
              {' · '}
              {formatNumber(data.coverage.meta.rows)} wierszy
            </p>
          )}
          {!isOverview && adsData?.coverage && (
            <p className="text-xs text-zinc-500 mt-1">
              Ad-level: <span className="text-zinc-400">{adsData.coverage.from}</span>
              {' → '}
              <span className="text-zinc-400">{adsData.coverage.to}</span>
              {' · '}
              {formatNumber(adsData.coverage.rows)} wierszy
            </p>
          )}
        </div>
        {isOverview
          ? <SyncMetaButton lastSync={data?.lastSync ?? null} />
          : <SyncAdsButton onDone={() => { setAdsKey(''); setAdsData(null); }} />}
      </div>

      {/* Zakładki */}
      <div className="flex gap-1 border-b border-zinc-800 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2.5 text-sm whitespace-nowrap transition-colors border-b-2 -mb-px',
              tab === t.id
                ? 'border-blue-500 text-blue-400 font-medium'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isOverview ? (
        <OverviewTab data={data} loading={loading} />
      ) : adsLoading ? (
        <div className="flex items-center justify-center h-96">
          <div className="animate-pulse text-zinc-500">Ładowanie danych ad-level...</div>
        </div>
      ) : !adsData || adsData.ads.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-96 gap-3">
          <p className="text-zinc-500">Brak danych ad-level w tym zakresie dat.</p>
          <p className="text-xs text-zinc-600">
            Użyj przycisku „Sync ad-level” powyżej, żeby pobrać reklamy, kreacje i metryki z Meta API.
          </p>
        </div>
      ) : tab === 'konta' ? (
        <AccountsSummary data={adsData} attribution={attribution} />
      ) : tab === 'kampanie' ? (
        <CampaignsTab
          campaigns={adsData.campaigns}
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          shop={filters.shop}
          attribution={attribution}
          onAttributionChange={setAttribution}
          onMetaSaved={handleCampaignMetaSaved}
        />
      ) : tab === 'zestawy' ? (
        <AdsetsTab
          adsets={adsData.adsets}
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          shop={filters.shop}
          attribution={attribution}
          onAttributionChange={setAttribution}
        />
      ) : (
        <CreativesTab
          data={adsData}
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          shop={filters.shop}
          attribution={attribution}
          onAttributionChange={setAttribution}
        />
      )}
    </div>
  );
}

// ============ Przegląd (dotychczasowa zawartość zakładki) ============

function OverviewTab({ data, loading }: { data: MarketingData | null; loading: boolean }) {
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
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard
          title="Total Spend"
          value={formatCurrency(data.kpis.totalSpend)}
          subLabel={data.kpis.totalSpendOriginal != null && data.kpis.originalCurrency
            ? `≈ ${formatNumber(data.kpis.totalSpendOriginal)} ${data.kpis.originalCurrency}`
            : undefined}
          icon={<DollarSign size={18} />}
        />
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

// Split [today-N, today-1] into ≤90-day chunks so each POST fits within
// Vercel Hobby's 60s function timeout. Returns newest chunk first.
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
  try {
    return JSON.parse(text);
  } catch {
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
    setSyncing(true);
    setResult(null);
    setProgress(null);
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
      setSyncing(false);
      setProgress(null);
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
        <span className="text-xs text-zinc-500">
          Meta: {formatRelativeTime(lastSync.at)}
        </span>
      ) : null}
      <select
        value={days}
        onChange={e => setDays(parseInt(e.target.value, 10))}
        disabled={syncing}
        className="bg-zinc-800 text-zinc-200 text-sm rounded-lg px-2 py-2 border border-zinc-700 disabled:opacity-50"
      >
        {BACKFILL_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <button onClick={handleSync} disabled={syncing}
        className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm rounded-lg transition-colors disabled:opacity-50">
        {syncing ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {syncing ? 'Sync...' : 'Sync Meta'}
      </button>
    </div>
  );
}

// Sync ad-level (reklamy + kreacje + dim_campaigns) — POST /api/etl/meta-ad-sync
// w chunkach ≤90 dni; po zakończeniu odświeża dane zakładek.
function SyncAdsButton({ onDone }: { onDone: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const [days, setDays] = useState(30);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSync() {
    setSyncing(true);
    setResult(null);
    setProgress(null);
    try {
      const chunks = buildBackfillChunks(days);
      let totalRows = 0;
      for (let i = 0; i < chunks.length; i++) {
        setProgress({ current: i + 1, total: chunks.length });
        const { since, until } = chunks[i];
        const res = await fetch(`/api/etl/meta-ad-sync?since=${since}&until=${until}`, { method: 'POST' });
        const json = await parseJsonOrThrow(res);
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        totalRows += json.totalRows || 0;
      }
      setResult({ ok: true, message: `Ad-level: pobrano ${totalRows} wierszy za ${days} dni` });
      onDone();
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSyncing(false);
      setProgress(null);
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
      ) : null}
      <select
        value={days}
        onChange={e => setDays(parseInt(e.target.value, 10))}
        disabled={syncing}
        className="bg-zinc-800 text-zinc-200 text-sm rounded-lg px-2 py-2 border border-zinc-700 disabled:opacity-50"
      >
        {BACKFILL_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <button onClick={handleSync} disabled={syncing}
        className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm rounded-lg transition-colors disabled:opacity-50">
        {syncing ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        {syncing ? 'Sync...' : 'Sync ad-level'}
      </button>
    </div>
  );
}
