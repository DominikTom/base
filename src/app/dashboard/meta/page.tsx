'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useDashboard } from '@/lib/dashboard-context';
import { KpiCard } from '@/components/ui/kpi-card';
import { ChartCard } from '@/components/charts/chart-card';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { CreativeCard, type CreativeCardData } from '@/components/meta/creative-card';
import { CreativeDetailSheet } from '@/components/meta/creative-detail-sheet';
import { ViewTabs, CampaignSubTabs, type MetaView, type CampaignSubview } from '@/components/meta/level-tabs';
import { FilterChips, type FilterChipsContext } from '@/components/meta/filter-chips';
import { HierarchyTable, type HierarchyRow } from '@/components/meta/hierarchy-table';
import { SyncMenu } from '@/components/meta/sync-menu';
import {
  DollarSign, Target, TrendingUp, MousePointerClick,
  Sparkles, Film, CheckCircle2, Clock, AlertCircle,
  Rocket, Flame, Eye, Anchor,
} from 'lucide-react';

interface MetaDashboardData {
  level: string;
  kpis: {
    spend: number; conversions: number; conversionValue: number;
    roas: number; cpa: number; ctr: number; hookRate: number;
    activeCreatives: number;
  };
  kpiDeltas: {
    spend: number | null; conversions: number | null; conversionValue: number | null;
    roas: number | null; cpa: number | null; ctr: number | null; hookRate: number | null;
    periodLabel: string;
  };
  topCreatives: CreativeCardData[];
  recentlyLaunched: CreativeCardData[];
  creativeBuckets: {
    scalable: CreativeCardData[];
    burning: CreativeCardData[];
    fresh: CreativeCardData[];
    stable: CreativeCardData[];
  };
  pulse: {
    winners: CreativeCardData[];
    losers: CreativeCardData[];
    freshWatch: CreativeCardData[];
  };
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

// CPA jest "lower is better" — odwracamy kierunek deltay (spadek = pozytyw).
function formatDelta(delta: number | null, lowerIsBetter = false): {
  label: string; cls: string;
} | null {
  if (delta === null) return null;
  const positive = lowerIsBetter ? delta < 0 : delta > 0;
  const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
  const cls = Math.abs(delta) < 1 ? 'text-zinc-500' :
              positive ? 'text-emerald-400' : 'text-red-400';
  return { label: `${arrow} ${Math.abs(delta).toFixed(1)}%`, cls };
}

function KpiWithDelta({
  title, value, icon, delta, lowerIsBetter, subLabel,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  delta: number | null;
  lowerIsBetter?: boolean;
  subLabel?: string;
}) {
  const d = formatDelta(delta, lowerIsBetter);
  return (
    <KpiCard
      title={title}
      value={value}
      icon={icon}
      subLabel={d ? `${d.label} vs poprzedni okres` : subLabel}
    />
  );
}

export default function MetaPage() {
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

  // 4 widoki task-oriented + sub-view dla campaigns
  const view = (searchParams.get('view') as MetaView) || 'creatives';
  const subview = (searchParams.get('sub') as CampaignSubview) || 'campaigns';
  const campaignId = searchParams.get('campaign_id') || null;
  const adsetId = searchParams.get('adset_id') || null;

  const [data, setData] = useState<MetaDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CreativeCardData | null>(null);

  const pushParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') params.delete(k);
      else params.set(k, v);
    }
    router.push(`${pathname}?${params.toString()}`);
  }, [searchParams, pathname, router]);

  // Dla API: campaigns view → level=campaign|adset zależnie od subview
  // Inne views → level=creative (bo i tak chcemy creatives data)
  const apiLevel = view === 'campaigns'
    ? (subview === 'adsets' ? 'adset' : 'campaign')
    : 'creative';

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        shop: filters.shop,
        level: apiLevel,
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
  }, [filters, apiLevel, campaignId, adsetId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Drill-down handlers
  const onCampaignClick = (row: HierarchyRow) => {
    pushParams({ view: 'campaigns', sub: 'adsets', campaign_id: row.id, adset_id: null });
  };
  const onAdsetClick = (row: HierarchyRow) => {
    pushParams({ view: 'creatives', sub: null, adset_id: row.id });
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
              <>Dane: <span className="text-zinc-400">{data.coverage.from}</span> → <span className="text-zinc-400">{data.coverage.to}</span> · {formatNumber(data.coverage.rows)} wierszy per-ad</>
            ) : 'Brak danych ad-level. Odpal sync.'}
            {data.lastSync && <span className="text-zinc-600"> · sync: {formatRelativeTime(data.lastSync.at)}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
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
          <SyncMenu onComplete={() => fetchData()} />
        </div>
      </div>

      {/* Tabs + filter chips */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <ViewTabs
          value={view}
          onChange={(next) => pushParams({ view: next, sub: null })}
        />
        <FilterChips
          context={data.filterContext}
          onClearCampaign={() => pushParams({ campaign_id: null })}
          onClearAdset={() => pushParams({ adset_id: null })}
        />
      </div>

      {/* Detail panel — globalny */}
      <CreativeDetailSheet creative={selected} onClose={() => setSelected(null)} />

      {/* === PULSE === */}
      {view === 'pulse' && (
        <>
          {/* KPI z deltami */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <KpiWithDelta title="Spend" value={formatCurrency(data.kpis.spend)} icon={<DollarSign size={18} />} delta={data.kpiDeltas.spend} />
            <KpiWithDelta title="Konwersje" value={formatNumber(data.kpis.conversions)} icon={<Target size={18} />} delta={data.kpiDeltas.conversions} />
            <KpiWithDelta title="Revenue" value={formatCurrency(data.kpis.conversionValue)} icon={<TrendingUp size={18} />} delta={data.kpiDeltas.conversionValue} />
            <KpiWithDelta title="ROAS" value={`${data.kpis.roas}x`} icon={<TrendingUp size={18} />} delta={data.kpiDeltas.roas} />
            <KpiWithDelta title="CPA" value={data.kpis.cpa > 0 ? `${data.kpis.cpa} zł` : '—'} icon={<Target size={18} />} delta={data.kpiDeltas.cpa} lowerIsBetter />
            <KpiWithDelta title="CTR" value={`${data.kpis.ctr}%`} icon={<MousePointerClick size={18} />} delta={data.kpiDeltas.ctr} />
            <KpiWithDelta title="Hook rate" value={`${data.kpis.hookRate}%`} icon={<Film size={18} />} delta={data.kpiDeltas.hookRate} subLabel={`${data.kpis.activeCreatives} kreacji`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <PulseColumn
              title="Skaluj — najszybciej rosnące"
              subtitle="Top 5 wg ↑ ROAS vs poprzedni okres"
              icon={<Rocket size={14} className="text-emerald-400" />}
              creatives={data.pulse.winners}
              empty="Brak kreacji z poprawą ROAS w wybranym okresie."
              onClick={setSelected}
            />
            <PulseColumn
              title="Wyłącz/zwróć uwagę — wypalają się"
              subtitle="Top 5 wg ↓ CTR (spend > 100 zł)"
              icon={<Flame size={14} className="text-red-400" />}
              creatives={data.pulse.losers}
              empty="Brak kreacji z istotnym spadkiem CTR. ✓"
              onClick={setSelected}
            />
            <PulseColumn
              title="Świeżaki — pierwsze 7 dni"
              subtitle="Watch list, czy łapią trakcję"
              icon={<Eye size={14} className="text-blue-400" />}
              creatives={data.pulse.freshWatch}
              empty="Brak nowych kreacji w ostatnim tygodniu."
              onClick={setSelected}
            />
          </div>
        </>
      )}

      {/* === KREACJE === */}
      {view === 'creatives' && (
        <>
          {/* Alert: kreacje bez podglądów lub w kolejce tagowania */}
          <DataHealthAlert
            topCreatives={data.topCreatives}
            taggingPending={data.tagging.pending}
          />
          {/* KPI strip podstawowy (bez deltów — Pulse od tego jest) */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <KpiCard title="Spend" value={formatCurrency(data.kpis.spend)} icon={<DollarSign size={18} />} />
            <KpiCard title="Konwersje" value={formatNumber(data.kpis.conversions)} icon={<Target size={18} />} />
            <KpiCard title="Revenue" value={formatCurrency(data.kpis.conversionValue)} icon={<TrendingUp size={18} />} />
            <KpiCard title="ROAS" value={`${data.kpis.roas}x`} icon={<TrendingUp size={18} />} />
            <KpiCard title="CPA" value={data.kpis.cpa > 0 ? `${data.kpis.cpa} zł` : '—'} icon={<Target size={18} />} />
            <KpiCard title="CTR" value={`${data.kpis.ctr}%`} icon={<MousePointerClick size={18} />} />
            <KpiCard title="Hook rate" value={`${data.kpis.hookRate}%`} icon={<Film size={18} />} subLabel={`${data.kpis.activeCreatives} kreacji`} />
          </div>

          <CreativeBucketSection
            title="Skalowalne"
            subtitle="ROAS ≥3, dojrzałe (>7 dni), spend stabilny lub rosnący — bezpieczne do skalowania"
            icon={<Rocket size={14} className="text-emerald-400" />}
            color="emerald"
            creatives={data.creativeBuckets.scalable}
            onClick={setSelected}
          />
          <CreativeBucketSection
            title="Wypalają się"
            subtitle="CTR spadł >25% vs poprzedni okres — czas na wariant lub wyłączenie"
            icon={<Flame size={14} className="text-red-400" />}
            color="red"
            creatives={data.creativeBuckets.burning}
            onClick={setSelected}
          />
          <CreativeBucketSection
            title="Świeże (≤14 dni)"
            subtitle="Watch list — sprawdź czy łapią trakcję"
            icon={<Eye size={14} className="text-blue-400" />}
            color="blue"
            creatives={data.creativeBuckets.fresh}
            onClick={setSelected}
          />
          <CreativeBucketSection
            title="Stabilne"
            subtitle="ROAS ≥2, działają >30 dni bez wahań — fundament budżetu"
            icon={<Anchor size={14} className="text-zinc-400" />}
            color="zinc"
            creatives={data.creativeBuckets.stable}
            onClick={setSelected}
          />

          {/* Top by spend — fallback gdy buckety puste */}
          {data.creativeBuckets.scalable.length === 0
            && data.creativeBuckets.burning.length === 0
            && data.creativeBuckets.fresh.length === 0
            && data.creativeBuckets.stable.length === 0 && (
            <ChartCard title="Top kreacje wg spendu" subtitle={`${data.topCreatives.length} kreacji`}>
              {data.topCreatives.length === 0 ? (
                <p className="text-sm text-zinc-500 py-12 text-center">
                  Brak kreacji w tym zakresie. Dotnij sync albo zmień zakres dat.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {data.topCreatives.map(c => (
                    <CreativeCard key={c.creative_id} data={c} onClick={() => setSelected(c)} />
                  ))}
                </div>
              )}
            </ChartCard>
          )}
        </>
      )}

      {/* === KAMPANIE === (operacyjny widok — agencja je ustawia) */}
      {view === 'campaigns' && (
        <>
          <CampaignSubTabs
            value={subview}
            onChange={(next) => pushParams({ sub: next })}
          />

          {subview === 'campaigns' && data.campaigns && (
            <ChartCard title="Kampanie" subtitle={`${data.campaigns.length} kampanii · klik w wiersz → zestawy`}>
              {data.campaigns.length === 0 ? (
                <p className="text-sm text-zinc-500 py-12 text-center">Brak kampanii w wybranym okresie.</p>
              ) : (
                <HierarchyTable rows={data.campaigns} variant="campaign" onRowClick={onCampaignClick} />
              )}
            </ChartCard>
          )}

          {subview === 'adsets' && data.adsets && (
            <ChartCard title="Zestawy reklam" subtitle={`${data.adsets.length} zestawów · klik w wiersz → kreacje`}>
              {data.adsets.length === 0 ? (
                <p className="text-sm text-zinc-500 py-12 text-center">Brak zestawów w wybranym zakresie/filtrze.</p>
              ) : (
                <HierarchyTable rows={data.adsets} variant="adset" onRowClick={onAdsetClick} />
              )}
            </ChartCard>
          )}
        </>
      )}

      {/* === INSIGHTS === (placeholder — w następnym commit'cie pełna logika) */}
      {view === 'insights' && (
        <ChartCard title="Insights" subtitle="Auto-generowane patterns z AI tagów — wkrótce">
          <p className="text-sm text-zinc-500 py-12 text-center max-w-2xl mx-auto">
            Tu pojawi się auto-analiza co odróżnia winnery od loserów: które
            formaty/kąty/style działają najlepiej, gdzie jest największa nisza.
            Klastrowanie po AI tagach Claude Vision.
          </p>
        </ChartCard>
      )}
    </div>
  );
}

// === Sub-components ===

function DataHealthAlert({
  topCreatives, taggingPending,
}: {
  topCreatives: CreativeCardData[];
  taggingPending: number;
}) {
  const missingThumbs = topCreatives.filter(
    c => !c.thumbnail_url && !c.image_url
  ).length;
  const totalShown = topCreatives.length;
  if (totalShown === 0) return null;
  const missingPct = totalShown > 0 ? Math.round((missingThumbs / totalShown) * 100) : 0;

  // Pokaż tylko gdy >30% kreacji bez podglądu albo >0 w kolejce tagowania
  if (missingPct < 30 && taggingPending === 0) return null;

  return (
    <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 flex items-start gap-3">
      <AlertCircle size={16} className="text-amber-400 shrink-0 mt-0.5" />
      <div className="flex-1 text-xs text-zinc-300 leading-relaxed">
        {missingPct >= 30 && (
          <p>
            <span className="font-medium text-amber-300">{missingThumbs} z {totalShown} kreacji</span>
            {' '}bez podglądu. Kliknij <span className="text-zinc-100 font-medium">Synchronizuj → Odśwież podglądy</span> w prawym górnym rogu.
          </p>
        )}
        {taggingPending > 0 && (
          <p className={missingPct >= 30 ? 'mt-1' : ''}>
            <span className="font-medium text-amber-300">{formatNumber(taggingPending)} kreacji</span>
            {' '}czeka na otagowanie AI. Kliknij <span className="text-zinc-100 font-medium">Synchronizuj → Otaguj AI</span> żeby uzupełnić tagi i analizę.
          </p>
        )}
      </div>
    </div>
  );
}

function PulseColumn({
  title, subtitle, icon, creatives, empty, onClick,
}: {
  title: string; subtitle: string; icon: React.ReactNode;
  creatives: CreativeCardData[]; empty: string;
  onClick: (c: CreativeCardData) => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
      </div>
      <p className="text-xs text-zinc-500 mb-4">{subtitle}</p>
      {creatives.length === 0 ? (
        <p className="text-xs text-zinc-600 py-8 text-center">{empty}</p>
      ) : (
        <div className="space-y-3">
          {creatives.map(c => (
            <CreativeMiniRow key={c.creative_id} data={c} onClick={() => onClick(c)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CreativeMiniRow({ data, onClick }: { data: CreativeCardData; onClick: () => void }) {
  const previewUrl = (data.image_url && data.image_url.length > 0) ? data.image_url : data.thumbnail_url;
  const ctrDelta = (data as unknown as { ctr_delta: number | null }).ctr_delta;
  const roasDelta = (data as unknown as { roas_delta: number | null }).roas_delta;
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full text-left p-2 rounded-lg hover:bg-zinc-800/50 transition-colors"
    >
      <div className="w-12 h-16 bg-zinc-950 rounded overflow-hidden shrink-0 border border-zinc-800">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : null}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-zinc-300 truncate">{data.title || data.creative_id.slice(-8)}</p>
        <p className="text-[11px] text-zinc-500 tabular-nums">
          {formatCurrency(data.spend)} · ROAS {data.roas.toFixed(2)}x · CTR {data.ctr.toFixed(2)}%
        </p>
        {(ctrDelta !== null && ctrDelta !== undefined) || (roasDelta !== null && roasDelta !== undefined) ? (
          <p className="text-[11px] tabular-nums">
            {roasDelta !== null && roasDelta !== undefined && (
              <span className={roasDelta > 0 ? 'text-emerald-400' : 'text-red-400'}>
                ROAS {roasDelta > 0 ? '↑' : '↓'} {Math.abs(roasDelta).toFixed(0)}%
              </span>
            )}
            {ctrDelta !== null && ctrDelta !== undefined && (
              <span className={`ml-2 ${ctrDelta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                CTR {ctrDelta > 0 ? '↑' : '↓'} {Math.abs(ctrDelta).toFixed(0)}%
              </span>
            )}
          </p>
        ) : null}
      </div>
    </button>
  );
}

function CreativeBucketSection({
  title, subtitle, icon, color, creatives, onClick,
}: {
  title: string; subtitle: string; icon: React.ReactNode;
  color: 'emerald' | 'red' | 'blue' | 'zinc';
  creatives: CreativeCardData[];
  onClick: (c: CreativeCardData) => void;
}) {
  if (creatives.length === 0) return null;
  const borderClasses: Record<typeof color, string> = {
    emerald: 'border-l-emerald-500/60',
    red: 'border-l-red-500/60',
    blue: 'border-l-blue-500/60',
    zinc: 'border-l-zinc-600',
  };
  return (
    <div className={`rounded-xl border border-zinc-800 border-l-4 ${borderClasses[color]} bg-zinc-900/30 p-5`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
        <span className="text-xs text-zinc-500 ml-1">({creatives.length})</span>
      </div>
      <p className="text-xs text-zinc-500 mb-4">{subtitle}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {creatives.map(c => (
          <CreativeCard key={c.creative_id} data={c} onClick={() => onClick(c)} />
        ))}
      </div>
    </div>
  );
}
