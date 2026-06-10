'use client';

import { useEffect, useState } from 'react';
import { useDashboard } from '@/lib/dashboard-context';
import { ChartCard } from '@/components/charts/chart-card';
import { SimpleBarChart } from '@/components/charts/bar-chart';
import { SimplePieChart } from '@/components/charts/pie-chart';
import { KpiCard } from '@/components/ui/kpi-card';
import { formatNumber } from '@/lib/utils';
import { previousPeriod, pctChange, COMPARE_LABEL } from '@/lib/period-compare';
import { Package } from 'lucide-react';

interface ProductsData {
  topByQuantity: Array<{ name: string; value: number; orderCount: number; category: string }>;
  topByOrders: Array<{ name: string; value: number; quantity: number; category: string }>;
  fabricChart: Array<{ name: string; value: number }>;
  sizeChart: Array<{ name: string; value: number }>;
  mattressChart: Array<{ name: string; value: number }>;
  headboardChart: Array<{ name: string; value: number }>;
  categoryChart: Array<{ name: string; value: number }>;
  totalProducts: number;
}

export default function ProductsPage() {
  const { filters } = useDashboard();
  const [data, setData] = useState<ProductsData | null>(null);
  const [prevData, setPrevData] = useState<ProductsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const prev = previousPeriod(filters.dateFrom, filters.dateTo);
        const mk = (df: string, dt: string) => new URLSearchParams({ date_from: df, date_to: dt, shop: filters.shop });
        const [curRes, prevRes] = await Promise.all([
          fetch(`/api/dashboard/products?${mk(filters.dateFrom, filters.dateTo)}`),
          fetch(`/api/dashboard/products?${mk(prev.from, prev.to)}`),
        ]);
        const cur = await curRes.json();
        const prv = prevRes.ok ? await prevRes.json() : null;
        setData(cur);
        setPrevData(prv);
      } catch {
        setData(null); setPrevData(null);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [filters]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-pulse text-muted">Ładowanie danych...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <p className="text-muted">Brak danych produktowych.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-fg">Analityka Produktów</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          title="Unikalne produkty"
          value={formatNumber(data.totalProducts)}
          icon={<Package size={18} />}
          change={pctChange(data.totalProducts, prevData?.totalProducts)}
          changeLabel={COMPARE_LABEL}
        />
        <KpiCard
          title="Top produkt (wg ilości)"
          value={data.topByQuantity[0]?.name || '-'}
          changeLabel={`${formatNumber(data.topByQuantity[0]?.value || 0)} szt.`}
        />
        <KpiCard
          title="Top kolekcja tkanin"
          value={data.fabricChart[0]?.name || '-'}
          changeLabel={`${formatNumber(data.fabricChart[0]?.value || 0)} szt.`}
        />
      </div>

      {/* Top products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Top 20 produktów wg ilości">
          <SimpleBarChart data={data.topByQuantity} layout="horizontal" height={500} barColor="#9333EA" />
        </ChartCard>
        <ChartCard title="Top 20 produktów wg zamówień">
          <SimpleBarChart data={data.topByOrders} layout="horizontal" height={500} barColor="#8b5cf6" />
        </ChartCard>
      </div>

      {/* Category breakdown */}
      <ChartCard title="Kategorie produktów">
        <SimplePieChart data={data.categoryChart} colorMap="category" height={350} />
      </ChartCard>

      {/* Fabric + Size */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Popularność kolekcji tkanin (Top 10)">
          <SimplePieChart data={data.fabricChart} height={320} />
        </ChartCard>
        <ChartCard title="Rozkład rozmiarów łóżek">
          <SimpleBarChart data={data.sizeChart} barColor="#16A34A" />
        </ChartCard>
      </div>

      {/* Mattress + Headboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Typ materaca">
          <SimpleBarChart data={data.mattressChart} barColor="#9333EA" />
        </ChartCard>
        <ChartCard title="Wysokość wezgłowia">
          <SimpleBarChart data={data.headboardChart} barColor="#ec4899" />
        </ChartCard>
      </div>

      {/* Attach rate materacy — nowy konfigurator dodaje materac jako osobną
          pozycję zamówienia; tu mierzymy ile zamówień łóżek idzie z materacem. */}
      <MattressAttachSection />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Materac przy łóżku (attach rate)
// ─────────────────────────────────────────────────────────────────
interface AttachStats {
  orders: number;
  withMattress: number;
  withoutMattress: number;
  attachRate: number;
}
interface AttachModelRow extends AttachStats { model: string }
interface AttachResponse {
  totals: AttachStats;
  perModel: AttachModelRow[];
  availableModels: Array<{ name: string; orders: number }>;
  error?: string;
}

function MattressAttachSection() {
  const { filters } = useDashboard();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [data, setData] = useState<AttachResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      shop: filters.shop,
    });
    if (selected.size > 0) params.set('models', [...selected].join(','));
    fetch(`/api/dashboard/mattress-attach?${params}`)
      .then(r => r.json())
      .then(j => { if (!cancelled) setData(j); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters.dateFrom, filters.dateTo, filters.shop, selected]);

  function toggleModel(name: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const totals = data?.totals;
  // Picker: top 20 modeli żeby nie zalać UI; reszta i tak ma znikome wolumeny.
  const pickerModels = (data?.availableModels || []).slice(0, 20);

  return (
    <ChartCard
      title="Materac przy łóżku (attach rate)"
      subtitle="Zamówienia wybranych łóżek z materacem jako osobną pozycją (nowy konfigurator) vs bez. Klikaj modele, aby filtrować — brak wyboru = wszystkie łóżka."
    >
      <div className="space-y-4">
        {/* Picker modeli */}
        <div className="flex flex-wrap gap-1.5">
          {pickerModels.map(m => {
            const active = selected.has(m.name);
            return (
              <button
                key={m.name}
                onClick={() => toggleModel(m.name)}
                className={`px-2.5 py-1 rounded-pill text-[11px] font-medium border transition-colors ${
                  active
                    ? 'bg-primary-600 border-transparent text-white'
                    : 'bg-bg border-line text-fg-soft hover:text-fg'
                }`}
              >
                {m.name} <span className="opacity-60">({m.orders})</span>
              </button>
            );
          })}
          {selected.size > 0 && (
            <button onClick={() => setSelected(new Set())} className="px-2.5 py-1 text-[11px] text-muted hover:text-fg-soft">
              Wyczyść
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-sm text-muted py-6">Liczenie…</div>
        ) : !data || data.error ? (
          <div className="text-sm text-danger py-3">Błąd: {data?.error || 'brak danych'}</div>
        ) : (
          <>
            {/* KPI */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <AttachKpi label="Zamówienia łóżek" value={formatNumber(totals?.orders ?? 0)} />
              <AttachKpi label="Z materacem" value={formatNumber(totals?.withMattress ?? 0)} accent="text-success" />
              <AttachKpi label="Bez materaca" value={formatNumber(totals?.withoutMattress ?? 0)} accent="text-muted" />
              <AttachKpi label="Attach rate" value={`${(totals?.attachRate ?? 0).toFixed(1)}%`} accent="text-primary-700" />
            </div>

            {/* Tabela per model */}
            <div className="overflow-auto rounded border border-line max-h-96">
              <table className="w-full text-xs">
                <thead className="bg-surface sticky top-0">
                  <tr className="text-fg-soft">
                    <th className="px-3 py-2 text-left font-medium">Model</th>
                    <th className="px-3 py-2 text-right font-medium">Zamówienia</th>
                    <th className="px-3 py-2 text-right font-medium">Z materacem</th>
                    <th className="px-3 py-2 text-right font-medium">Bez</th>
                    <th className="px-3 py-2 text-right font-medium">Attach %</th>
                    <th className="px-3 py-2 w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.perModel.map(row => (
                    <tr key={row.model} className="border-t border-line hover:bg-bg">
                      <td className="px-3 py-1.5 text-fg-soft">{row.model}</td>
                      <td className="px-3 py-1.5 text-right text-fg tabular-nums">{formatNumber(row.orders)}</td>
                      <td className="px-3 py-1.5 text-right text-success tabular-nums">{formatNumber(row.withMattress)}</td>
                      <td className="px-3 py-1.5 text-right text-muted tabular-nums">{formatNumber(row.withoutMattress)}</td>
                      <td className="px-3 py-1.5 text-right font-semibold text-fg tabular-nums">{row.attachRate.toFixed(1)}%</td>
                      <td className="px-3 py-1.5">
                        <div className="h-2 bg-bg rounded-pill overflow-hidden">
                          <div className="h-full bg-primary-500 rounded-pill" style={{ width: `${Math.min(100, row.attachRate)}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </ChartCard>
  );
}

function AttachKpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg/50 p-3">
      <div className="text-[11px] text-muted uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-bold tracking-tight mt-0.5 ${accent || 'text-fg'}`}>{value}</div>
    </div>
  );
}
