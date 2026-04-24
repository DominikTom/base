'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useDashboard } from '@/lib/dashboard-context';
import { KpiCard } from '@/components/ui/kpi-card';
import { ChartCard } from '@/components/charts/chart-card';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { CreativeCard, type CreativeCardData } from '@/components/meta/creative-card';
import { CreativeDetailSheet } from '@/components/meta/creative-detail-sheet';
import { LevelTabs, type MetaLevel } from '@/components/meta/level-tabs';
import { FilterChips, type FilterChipsContext } from '@/components/meta/filter-chips';
import { HierarchyTable, type HierarchyRow } from '@/components/meta/hierarchy-table';
import {
  DollarSign, Target, TrendingUp, MousePointerClick, Percent,
  Sparkles, Film, CheckCircle2, Clock, AlertCircle,
} from 'lucide-react';

interface MetaDashboardData {
  level: MetaLevel;
  kpis: {
    spend: number;
    conversions: number;
    conversionValue: number;
    roas: number;
    cpa: number;
    ctr: number;
    hookRate: number;
    activeCreatives: number;
  };
  topCreatives: CreativeCardData[];
  recentlyLaunched: CreativeCardData[];
  campaigns: HierarchyRow[] | null;
  adsets: HierarchyRow[] | null;
  filterContext: FilterChipsContext;
  coverage: { from: string; to: string; rows: number } | null;
  tagging: { completed: number; pending: number; failed: number };
  lastSync: { at: string; rows: number } | null;
}

function formatRelativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'przed chwilą';
  if (mins < 60) return `${mins} min temu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h temu`;
  return `${Math.floor(hours / 24)}d temu`;
}

export default function MetaPage() {
  // useSearchParams w Next 16 wymaga Suspense boundary przy prerenderingu.
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-96"><div className="animate-pulse text-zinc-500">Ładowanie…</div></div>}>
      <MetaPageInner />
    </Suspense>
  );
}

function MetaPageInner() {
  const { filters } = useDashboard();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const level = (searchParams.get('level') as MetaLevel) || 'creative';
  const campaignId = searchParams.get('campaign_id') || null;
  const adsetId = searchParams.get('adset_id') || null;

  const [data, setData] = useState<MetaDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CreativeCardData | null>(null);

  // URL helper — podmienia search params a zachowuje resztę.
  const pushParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') params.delete(k);
      else params.set(k, v);
    }
    router.push(`${pathname}?${params.toString()}`);
  }, [searchParams, pathname, router]);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          date_from: filters.dateFrom,
          date_to: filters.dateTo,
          shop: filters.shop,
          level,
        });
        if (campaignId) params.set('campaign_id', campaignId);
        if (adsetId) params.set('adset_id', adsetId);
        const res = await fetch(`/api/dashboard/meta?${params}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Błąd API');
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [filters, level, campaignId, adsetId]);

  // Handlery drill-down
  const onLevelChange = (next: MetaLevel) => {
    // Zmiana levela zachowuje filtry (chyba że wracamy do campaign — czyść filtr adsetu)
    const updates: Record<string, string | null> = { level: next };
    if (next === 'campaign') {
      updates.campaign_id = null;
      updates.adset_id = null;
    } else if (next === 'adset') {
      updates.adset_id = null;
    }
    pushParams(updates);
  };

  const onCampaignClick = (row: HierarchyRow) => {
    pushParams({ level: 'adset', campaign_id: row.id, adset_id: null });
  };

  const onAdsetClick = (row: HierarchyRow) => {
    pushParams({ level: 'creative', adset_id: row.id });
  };

  if (loading && !data) {
    return <div className="flex items-center justify-center h-96"><div className="animate-pulse text-zinc-500">Ładowanie danych Meta…</div></div>;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertCircle className="text-red-400" size={32} />
        <p className="text-zinc-400 text-sm">{error || 'Brak danych. Uruchom sync ad-level w ETL Admin.'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100 flex items-center gap-2">
            <Sparkles size={18} className="text-purple-400" />
            Meta — Creative Analytics
          </h1>
          <p className="text-xs text-zinc-500 mt-1">
            {data.coverage ? (
              <>
                Dane: <span className="text-zinc-400">{data.coverage.from}</span>
                {' → '}
                <span className="text-zinc-400">{data.coverage.to}</span>
                {' · '}{formatNumber(data.coverage.rows)} wierszy per-ad
              </>
            ) : 'Brak danych ad-level. Odpal sync.'}
            {data.lastSync && (
              <span className="text-zinc-600"> · sync: {formatRelativeTime(data.lastSync.at)}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {data.tagging.completed > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 size={12} /> {formatNumber(data.tagging.completed)} otagowane
            </span>
          )}
          {data.tagging.pending > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 text-amber-400">
              <Clock size={12} /> {formatNumber(data.tagging.pending)} w kolejce
            </span>
          )}
          {data.tagging.failed > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-500/10 text-red-400">
              <AlertCircle size={12} /> {formatNumber(data.tagging.failed)} błędy
            </span>
          )}
        </div>
      </div>

      {/* Tabs + filter chips */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <LevelTabs value={level} onChange={onLevelChange} />
        <FilterChips
          context={data.filterContext}
          onClearCampaign={() => pushParams({ campaign_id: null })}
          onClearAdset={() => pushParams({ adset_id: null })}
        />
      </div>

      {/* KPI strip — wspólne dla wszystkich levelów, zastosowane filtry */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <KpiCard title="Spend" value={formatCurrency(data.kpis.spend)} icon={<DollarSign size={18} />} />
        <KpiCard title="Konwersje" value={formatNumber(data.kpis.conversions)} icon={<Target size={18} />} />
        <KpiCard title="Revenue" value={formatCurrency(data.kpis.conversionValue)} icon={<TrendingUp size={18} />} />
        <KpiCard title="ROAS" value={`${data.kpis.roas}x`} icon={<TrendingUp size={18} />} />
        <KpiCard title="CPA" value={data.kpis.cpa > 0 ? `${data.kpis.cpa} zł` : '—'} icon={<Target size={18} />} />
        <KpiCard title="CTR" value={`${data.kpis.ctr}%`} icon={<MousePointerClick size={18} />} />
        <KpiCard title="Hook rate" value={`${data.kpis.hookRate}%`} icon={<Film size={18} />} subLabel={`${data.kpis.activeCreatives} kreacji`} />
      </div>

      {/* Detail panel — collapsible, globalny dla wszystkich levelów */}
      <CreativeDetailSheet creative={selected} onClose={() => setSelected(null)} />

      {/* Content per level */}
      {level === 'campaign' && data.campaigns && (
        <ChartCard title="Kampanie" subtitle={`${data.campaigns.length} kampanii · klik w wiersz → zestawy`}>
          {data.campaigns.length === 0 ? (
            <p className="text-sm text-zinc-500 py-12 text-center">Brak kampanii w wybranym okresie.</p>
          ) : (
            <HierarchyTable rows={data.campaigns} variant="campaign" onRowClick={onCampaignClick} />
          )}
        </ChartCard>
      )}

      {level === 'adset' && data.adsets && (
        <ChartCard title="Zestawy reklam" subtitle={`${data.adsets.length} zestawów · klik w wiersz → kreacje`}>
          {data.adsets.length === 0 ? (
            <p className="text-sm text-zinc-500 py-12 text-center">
              Brak zestawów w wybranym zakresie/filtrze.
            </p>
          ) : (
            <HierarchyTable rows={data.adsets} variant="adset" onRowClick={onAdsetClick} />
          )}
        </ChartCard>
      )}

      {level === 'creative' && (
        <>
          <ChartCard
            title="Top kreacje wg spendu"
            subtitle={`${data.topCreatives.length} kreacji · próg min 50 zł spendu`}
          >
            {data.topCreatives.length === 0 ? (
              <p className="text-sm text-zinc-500 py-12 text-center">
                Brak kreacji w tym zakresie/filtrze.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {data.topCreatives.map(c => (
                  <CreativeCard key={c.creative_id} data={c} onClick={() => setSelected(c)} />
                ))}
              </div>
            )}
          </ChartCard>

          {data.recentlyLaunched.length > 0 && (
            <ChartCard
              title="Nowe kreacje (ostatnie 14 dni)"
              subtitle={`${data.recentlyLaunched.length} kreacji · sortowane od najnowszej`}
            >
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {data.recentlyLaunched.map(c => (
                  <CreativeCard key={c.creative_id} data={c} onClick={() => setSelected(c)} />
                ))}
              </div>
            </ChartCard>
          )}
        </>
      )}
    </div>
  );
}
