'use client';

import { useEffect, useState } from 'react';
import { Sparkles, RefreshCw, TrendingUp, TrendingDown, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import { cn } from '@/lib/utils';

type InsightKind = 'positive' | 'negative' | 'neutral' | 'alert';
interface Insight {
  title: string;
  body: string;
  badge?: string | null;
  kind: InsightKind;
}

interface InsightsResponse {
  insights: Insight[];
  generated_at?: string;
  age_minutes?: number;
  cached?: boolean;
  range: '7d' | '30d';
  shop: string;
  error?: string;
}

const KIND_STYLE: Record<InsightKind, { dot: string; badge: string; icon: React.ReactNode }> = {
  positive: { dot: 'bg-success', badge: 'bg-green-100 text-success', icon: <TrendingUp size={12} /> },
  negative: { dot: 'bg-danger',  badge: 'bg-rose-100 text-danger',   icon: <TrendingDown size={12} /> },
  alert:    { dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700', icon: <AlertTriangle size={12} /> },
  neutral:  { dot: 'bg-primary-500', badge: 'bg-primary-100 text-primary-700', icon: <ArrowUpRight size={12} /> },
};

export function InsightsCard() {
  const { filters } = useDashboard();
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<'7d' | '30d'>('7d');

  async function load(force = false) {
    setLoading(!data); setRefreshing(force);
    try {
      const params = new URLSearchParams({ shop: filters.shop || 'all', range });
      if (force) params.set('force', '1');
      const res = await fetch(`/api/insights?${params}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setData({ insights: [], range, shop: filters.shop, error: String(err) });
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.shop, range]);

  const insights = data?.insights || [];

  return (
    <div className="relative overflow-hidden rounded-card border border-line bg-surface shadow-card p-6">
      {/* Subtle gradient blob */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-60"
        style={{
          background: 'radial-gradient(circle at center, #E9D5FF 0%, #FAF5FF 50%, transparent 75%)',
        }}
      />

      <div className="relative flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-accent-bg text-accent-fg flex items-center justify-center shrink-0">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-fg">Wskazówki AI</h2>
            <p className="text-xs text-muted mt-0.5">
              Analiza ostatnich {range === '30d' ? '30' : '7'} dni vs poprzedni okres
              {data?.cached && data.age_minutes != null && (
                <span className="ml-2 text-muted/70">· cache {data.age_minutes}m</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex items-center bg-bg border border-line rounded-pill p-1">
            <button
              onClick={() => setRange('7d')}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-pill transition-colors',
                range === '7d' ? 'bg-accent-bg text-accent-fg' : 'text-fg-soft hover:text-fg',
              )}
            >
              7 dni
            </button>
            <button
              onClick={() => setRange('30d')}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-pill transition-colors',
                range === '30d' ? 'bg-accent-bg text-accent-fg' : 'text-fg-soft hover:text-fg',
              )}
            >
              30 dni
            </button>
          </div>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="p-2 rounded-pill text-fg-soft hover:text-fg hover:bg-bg transition-colors disabled:opacity-50"
            title="Odśwież"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="relative">
        {loading && !data && (
          <div className="text-sm text-muted py-6">Ładowanie wskazówek…</div>
        )}
        {!loading && data?.error && (
          <div className="text-sm text-danger py-3">Błąd: {data.error}</div>
        )}
        {!loading && insights.length === 0 && !data?.error && (
          <div className="text-sm text-muted py-3">Brak istotnych zmian do raportowania.</div>
        )}
        {insights.length > 0 && (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {insights.map((ins, i) => {
              const style = KIND_STYLE[ins.kind] || KIND_STYLE.neutral;
              return (
                <li
                  key={i}
                  className="group relative rounded-2xl border border-line bg-bg/40 hover:bg-bg p-4 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span className={cn('w-1.5 h-1.5 rounded-full mt-2 shrink-0', style.dot)} aria-hidden />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 flex-wrap mb-1">
                        <h3 className="text-sm font-semibold text-fg">{ins.title}</h3>
                        {ins.badge && (
                          <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-pill', style.badge)}>
                            {style.icon}
                            {ins.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-fg-soft leading-relaxed">{ins.body}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
