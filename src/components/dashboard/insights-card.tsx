'use client';

import { useEffect, useState } from 'react';
import { Sparkles, RefreshCw, TrendingUp, TrendingDown, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import { shopFilterLabel } from '@/lib/shop-filter';
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
  range: '7d' | '30d' | 'quarter';
  shop: string;
  error?: string;
}

const KIND_STYLE: Record<InsightKind, { dot: string; badge: string; icon: React.ReactNode }> = {
  positive: { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <TrendingUp size={12} /> },
  negative: { dot: 'bg-red-500',  badge: 'bg-red-50 text-red-700 border-red-200',   icon: <TrendingDown size={12} /> },
  alert:    { dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200', icon: <AlertTriangle size={12} /> },
  neutral:  { dot: 'bg-primary', badge: 'bg-primary-soft text-primary-ink border-primary/20', icon: <ArrowUpRight size={12} /> },
};

export function InsightsCard() {
  const { filters } = useDashboard();
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<'7d' | '30d' | 'quarter'>('30d');

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
    <div className="card relative overflow-hidden p-6">
      {/* Subtelna poświata primary — jak app-ambient, działa w obu motywach */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full"
        style={{ background: 'radial-gradient(circle at center, rgb(var(--primary) / 0.14) 0%, rgb(var(--primary) / 0.05) 50%, transparent 75%)' }}
      />

      <div className="relative flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary-soft text-primary-ink flex items-center justify-center shrink-0">
            <Sparkles size={18} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-ink">Wskazówki AI</h2>
            <p className="text-xs text-ink-muted mt-0.5">
              Sklep:{' '}
              <span className="font-medium text-ink-soft">
                {shopFilterLabel(filters.shop)}
              </span>
              {' · '}
              {range === 'quarter' ? 'ostatni kwartał (90 dni)' : `ostatnie ${range === '30d' ? '30' : '7'} dni`}
              {' vs poprzedni okres'}
              {data?.cached && data.age_minutes != null && (
                <span className="ml-2 text-ink-faint">· cache {data.age_minutes}m</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex items-center bg-surface-2 rounded-xl p-1">
            {([
              { key: '7d', label: '7 dni' },
              { key: '30d', label: '30 dni' },
              { key: 'quarter', label: 'Kwartał' },
            ] as const).map(opt => (
              <button
                key={opt.key}
                onClick={() => setRange(opt.key)}
                className={cn(
                  'px-3 py-1 text-xs font-medium rounded-lg transition-colors',
                  range === opt.key ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink hover:bg-surface',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="p-2 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-2 transition-colors disabled:opacity-50"
            title="Odśwież"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="relative">
        {loading && !data && (
          <div className="text-sm text-ink-faint py-6">Ładowanie wskazówek…</div>
        )}
        {!loading && data?.error && (
          <div className="text-sm text-red-600 py-3">Błąd: {data.error}</div>
        )}
        {!loading && insights.length === 0 && !data?.error && (
          <div className="text-sm text-ink-muted py-3">Brak istotnych zmian do raportowania.</div>
        )}
        {insights.length > 0 && (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {insights.map((ins, i) => {
              const style = KIND_STYLE[ins.kind] || KIND_STYLE.neutral;
              return (
                <li
                  key={i}
                  className="group relative rounded-2xl border border-line bg-surface-2/40 hover:bg-surface-2 p-4 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span className={cn('w-1.5 h-1.5 rounded-full mt-2 shrink-0', style.dot)} aria-hidden />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 flex-wrap mb-1">
                        <h3 className="text-sm font-semibold text-ink">{ins.title}</h3>
                        {ins.badge && (
                          <span className={cn('chip gap-1', style.badge)}>
                            {style.icon}
                            {ins.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-ink-soft leading-relaxed">{ins.body}</p>
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
