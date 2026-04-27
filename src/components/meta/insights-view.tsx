'use client';

import { useEffect, useState } from 'react';
import { useDashboard } from '@/lib/dashboard-context';
import { ChartCard } from '@/components/charts/chart-card';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { Lightbulb, TrendingUp, AlertCircle, Sparkles } from 'lucide-react';

interface InsightSentence {
  text: string;
  axis: string;
  metric: string;
  significance: 'high' | 'medium' | 'low';
}

interface SegmentMetric {
  segment: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  roas: number;
  ctr: number;
  cpa: number;
  hook_rate: number;
  creatives: number;
}

interface InsightsData {
  coverage: { total: number; tagged: number; coverage_pct: number };
  insights: InsightSentence[];
  breakdowns: Record<string, { label: string; segments: SegmentMetric[] }>;
}

export function InsightsView() {
  const { filters } = useDashboard();
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      shop: filters.shop,
    });
    fetch(`/api/dashboard/meta/insights?${params}`)
      .then(r => r.json())
      .then(json => {
        if (json.error) throw new Error(json.error);
        setData(json);
      })
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [filters]);

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-pulse text-zinc-500">Analiza patterns…</div></div>;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertCircle className="text-red-400" size={32} />
        <p className="text-zinc-400 text-sm">{error || 'Brak danych do analizy.'}</p>
      </div>
    );
  }

  // Wymaga AI tagging coverage > 0
  if (data.coverage.tagged === 0) {
    return (
      <ChartCard title="Insights" subtitle="Auto-generowane patterns z AI tagów">
        <div className="text-center py-12 max-w-xl mx-auto space-y-3">
          <Sparkles size={32} className="text-fuchsia-400/60 mx-auto" />
          <p className="text-sm text-zinc-300">
            Żadna z {data.coverage.total} kreacji nie ma jeszcze tagów AI.
          </p>
          <p className="text-xs text-zinc-500">
            Insights opierają się na klasyfikacji Claude Vision.
            Kliknij <span className="text-zinc-100 font-medium">Synchronizuj → Otaguj AI</span> żeby uruchomić.
          </p>
        </div>
      </ChartCard>
    );
  }

  return (
    <div className="space-y-6">
      {/* Coverage banner */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 text-xs text-zinc-400 flex items-center gap-3">
        <Sparkles size={14} className="text-purple-400" />
        Analiza oparta na <span className="text-zinc-200 font-medium">{formatNumber(data.coverage.tagged)}</span> otagowanych
        kreacji z {formatNumber(data.coverage.total)} ({data.coverage.coverage_pct}%).
        {data.coverage.coverage_pct < 60 && (
          <span className="text-amber-400 ml-2">
            ⚠️ Niska pokrycie — odpal "Otaguj AI" żeby insights były bardziej miarodajne.
          </span>
        )}
      </div>

      {/* Top insights */}
      {data.insights.length > 0 && (
        <ChartCard title="Co działa najlepiej" subtitle="Auto-generowane porównania segmentów">
          <div className="space-y-3">
            {data.insights.slice(0, 12).map((ins, i) => (
              <InsightRow key={i} insight={ins} />
            ))}
          </div>
        </ChartCard>
      )}

      {data.insights.length === 0 && (
        <ChartCard title="Brak istotnych różnic" subtitle="Reguły szukają >15% różnic między segmentami przy >2 kreacjach każdy">
          <p className="text-sm text-zinc-500 py-12 text-center max-w-xl mx-auto">
            Nie znaleziono jeszcze istotnych pattern'ów. Wymaga większej liczby
            otagowanych kreacji (najlepiej >20). Otaguj więcej kreacji albo
            zwiększ zakres dat.
          </p>
        </ChartCard>
      )}

      {/* Breakdowns per axis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Object.entries(data.breakdowns).map(([key, bd]) => (
          <SegmentBreakdown key={key} label={bd.label} segments={bd.segments} />
        ))}
      </div>
    </div>
  );
}

function InsightRow({ insight }: { insight: InsightSentence }) {
  const sigCls: Record<InsightSentence['significance'], string> = {
    high: 'border-l-emerald-500/60',
    medium: 'border-l-amber-500/60',
    low: 'border-l-zinc-700',
  };
  const sigBg: Record<InsightSentence['significance'], string> = {
    high: 'bg-emerald-500/5',
    medium: 'bg-amber-500/5',
    low: 'bg-zinc-900/40',
  };
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border-l-2 ${sigCls[insight.significance]} ${sigBg[insight.significance]}`}>
      <Lightbulb size={14} className="text-amber-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-200 leading-relaxed">{insight.text}</p>
        <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wide">
          {insight.axis} · {insight.metric}
        </p>
      </div>
    </div>
  );
}

function SegmentBreakdown({ label, segments }: { label: string; segments: SegmentMetric[] }) {
  const maxSpend = Math.max(...segments.map(s => s.spend), 1);
  return (
    <ChartCard title={label} subtitle={`${segments.length} segmentów · sortowane wg spendu`}>
      <div className="space-y-2">
        {segments.map(s => {
          const widthPct = Math.round((s.spend / maxSpend) * 100);
          const roasColor =
            s.roas >= 3 ? 'text-emerald-400' :
            s.roas >= 1 ? 'text-zinc-300' : 'text-red-400';
          return (
            <div key={s.segment} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-zinc-300 truncate">{s.segment}</span>
                <div className="flex items-baseline gap-3 tabular-nums shrink-0">
                  <span className="text-zinc-500">{s.creatives} szt.</span>
                  <span className="text-zinc-400">{formatCurrency(s.spend)}</span>
                  <span className={roasColor}>{s.roas.toFixed(2)}x</span>
                  <span className="text-zinc-500">CTR {s.ctr.toFixed(1)}%</span>
                </div>
              </div>
              <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500/60 to-purple-400/60 rounded-full"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}
