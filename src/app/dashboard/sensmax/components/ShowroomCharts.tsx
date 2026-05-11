'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useDashboard } from '@/lib/dashboard-context';
import { ChartCard } from '@/components/charts/chart-card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { SHOWROOMS, SHOWROOM_LABELS, SHOWROOM_COLORS, type Showroom } from '@/lib/sensmax/types';

interface AllResponse {
  mode: 'all';
  from: string;
  to: string;
  rows: Array<{ showroom: Showroom; date: string; visits: number }>;
  totals: Record<string, number>;
  error?: string;
}

interface SingleResponse {
  mode: 'single';
  showroom: Showroom;
  from: string;
  to: string;
  hourlyFrom: string;
  daily: Array<{ date: string; visits: number; errors: number }>;
  hourly: Array<{ date: string; hour: number; visits: number }>;
  error?: string;
}

const tooltipStyle = { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 } as const;
const axisTick = { fontSize: 10, fill: '#71717a' } as const;
const plNum = (n: number) => n.toLocaleString('pl-PL');

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

interface SummaryRow {
  showroom: Showroom;
  label: string;
  total: number;
  perDay: number;
  share: number;
  bestDayVisits: number;
  bestDayDate: string;
}

export function ShowroomCharts() {
  const { filters } = useDashboard();
  const { dateFrom, dateTo } = filters;

  const [selected, setSelected] = useState<Showroom>('katowice');
  const [agg, setAgg] = useState<'daily' | 'weekly'>('daily');
  const [hidden, setHidden] = useState<Set<Showroom>>(new Set());

  const [all, setAll] = useState<AllResponse | null>(null);
  const [single, setSingle] = useState<SingleResponse | null>(null);
  const [loadingAll, setLoadingAll] = useState(true);
  const [loadingSingle, setLoadingSingle] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoadingAll(true);
    fetch(`/api/sensmax/historical?showroom=all&from=${dateFrom}&to=${dateTo}`)
      .then((r) => r.json())
      .then((j: AllResponse) => {
        if (alive) setAll(j.error ? null : j);
      })
      .catch(() => {
        if (alive) setAll(null);
      })
      .finally(() => {
        if (alive) setLoadingAll(false);
      });
    return () => {
      alive = false;
    };
  }, [dateFrom, dateTo]);

  useEffect(() => {
    let alive = true;
    setLoadingSingle(true);
    fetch(`/api/sensmax/historical?showroom=${selected}&from=${dateFrom}&to=${dateTo}`)
      .then((r) => r.json())
      .then((j: SingleResponse) => {
        if (alive) setSingle(j.error ? null : j);
      })
      .catch(() => {
        if (alive) setSingle(null);
      })
      .finally(() => {
        if (alive) setLoadingSingle(false);
      });
    return () => {
      alive = false;
    };
  }, [selected, dateFrom, dateTo]);

  const activeShowrooms = useMemo(() => {
    const totals = all?.totals ?? {};
    const present = new Set((all?.rows ?? []).map((r) => r.showroom));
    return SHOWROOMS.filter((s) => present.has(s) || (totals[s] ?? 0) > 0);
  }, [all]);

  const compareData = useMemo(() => {
    const rows = all?.rows ?? [];
    const map = new Map<string, Record<string, number | string>>();
    for (const r of rows) {
      const bucket = agg === 'weekly' ? mondayOf(r.date) : r.date;
      if (!map.has(bucket)) map.set(bucket, { name: bucket.slice(5), _key: bucket });
      const o = map.get(bucket)!;
      o[r.showroom] = (Number(o[r.showroom]) || 0) + r.visits;
    }
    return [...map.values()].sort((a, b) => (String(a._key) < String(b._key) ? -1 : 1));
  }, [all, agg]);

  const summaryRows = useMemo<SummaryRow[]>(() => {
    const rows = all?.rows ?? [];
    const totals = all?.totals ?? {};
    const grand = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
    return activeShowrooms
      .map((s) => {
        const own = rows.filter((r) => r.showroom === s);
        const total = totals[s] ?? 0;
        const days = own.length || 1;
        let bestDayVisits = 0;
        let bestDayDate = '—';
        for (const r of own) {
          if (r.visits > bestDayVisits) {
            bestDayVisits = r.visits;
            bestDayDate = r.date;
          }
        }
        return {
          showroom: s,
          label: SHOWROOM_LABELS[s],
          total,
          perDay: Math.round((total / days) * 10) / 10,
          share: Math.round((total / grand) * 1000) / 10,
          bestDayVisits,
          bestDayDate,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [all, activeShowrooms]);

  const summaryColumns: Column<SummaryRow>[] = useMemo(
    () => [
      { key: 'label', header: 'Showroom', accessor: (r) => r.label, sortable: true },
      { key: 'total', header: 'Wejścia (okres)', accessor: (r) => r.total, format: (v) => plNum(Number(v)), align: 'right', sortable: true },
      { key: 'perDay', header: 'Śr. / dzień', accessor: (r) => r.perDay, format: (v) => plNum(Number(v)), align: 'right', sortable: true },
      { key: 'share', header: 'Udział', accessor: (r) => r.share, format: (v) => `${v}%`, align: 'right', sortable: true },
      { key: 'best', header: 'Najlepszy dzień', accessor: (r) => r.bestDayVisits, format: (v) => plNum(Number(v)), align: 'right', sortable: true },
      { key: 'bestDate', header: 'Data', accessor: (r) => r.bestDayDate, align: 'right', sortable: true },
    ],
    [],
  );

  const detailDaily = useMemo(() => (single?.daily ?? []).map((d) => ({ name: d.date.slice(5), visits: d.visits })), [single]);
  const detailHourlyAvg = useMemo(() => {
    const sums = new Array(24).fill(0) as number[];
    const days = new Set<string>();
    for (const h of single?.hourly ?? []) {
      sums[h.hour] += h.visits;
      days.add(h.date);
    }
    const n = Math.max(days.size, 1);
    return sums.map((s, hour) => ({ name: String(hour).padStart(2, '0'), visits: Math.round((s / n) * 10) / 10 }));
  }, [single]);
  const heat = useMemo(() => {
    const byDate = new Map<string, number[]>();
    for (const h of single?.hourly ?? []) {
      if (!byDate.has(h.date)) byDate.set(h.date, new Array(24).fill(0) as number[]);
      byDate.get(h.date)![h.hour] += h.visits;
    }
    const dates = [...byDate.keys()].sort();
    let max = 1;
    for (const d of dates) for (const v of byDate.get(d)!) if (v > max) max = v;
    return { dates, byDate, max };
  }, [single]);

  const toggleShowroom = (s: Showroom) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const allHasData = !!all && all.rows.length > 0;
  const detailHasData = !!single && single.daily.length > 0;
  const detailTotal = (single?.daily ?? []).reduce((a, d) => a + d.visits, 0);

  const emptyNote = (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-sm text-zinc-400">
      Brak danych historycznych w tym zakresie. Zmień zakres dat u góry, uruchom synchronizację (
      <code className="text-zinc-300">POST /api/sensmax/sync</code>) lub poczekaj na nocny cron.
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ── Porównanie showroomów ─────────────────────────────────────────── */}
      <ChartCard
        title="Porównanie showroomów"
        subtitle={all ? `${all.from} – ${all.to}` : undefined}
        action={
          <div className="flex rounded-md border border-zinc-700 text-xs">
            {(['daily', 'weekly'] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAgg(a)}
                className={`px-3 py-1 ${agg === a ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                {a === 'daily' ? 'Dziennie' : 'Tygodniowo'}
              </button>
            ))}
          </div>
        }
      >
        {loadingAll && <div className="text-sm text-zinc-500">Ładowanie…</div>}
        {!loadingAll && !allHasData && emptyNote}
        {!loadingAll && allHasData && (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {activeShowrooms.map((s) => {
                const off = hidden.has(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleShowroom(s)}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      off ? 'border-zinc-800 text-zinc-600' : 'border-zinc-700 text-zinc-200 hover:bg-zinc-800'
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: off ? '#52525b' : SHOWROOM_COLORS[s] }} />
                    <span className={off ? 'line-through' : ''}>{SHOWROOM_LABELS[s]}</span>
                  </button>
                );
              })}
            </div>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={compareData} margin={{ top: 5, right: 8, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: '#3f3f46' }} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                {activeShowrooms.map((s) => (
                  <Line
                    key={s}
                    type="monotone"
                    dataKey={s}
                    name={SHOWROOM_LABELS[s]}
                    stroke={SHOWROOM_COLORS[s]}
                    strokeWidth={2}
                    dot={false}
                    hide={hidden.has(s)}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </ChartCard>

      {/* ── Zestawienie ───────────────────────────────────────────────────── */}
      {allHasData && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-zinc-200">Zestawienie ({all!.from} – {all!.to})</h3>
          <DataTable data={summaryRows} columns={summaryColumns} onRowClick={(r) => setSelected(r.showroom)} />
          <p className="mt-1.5 text-xs text-zinc-500">Kliknij wiersz, aby zobaczyć szczegóły showroomu poniżej.</p>
        </div>
      )}

      {/* ── Szczegóły wybranego showroomu ─────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-zinc-200">Szczegóły:</span>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value as Showroom)}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
          >
            {SHOWROOMS.map((s) => (
              <option key={s} value={s}>
                {SHOWROOM_LABELS[s]}
              </option>
            ))}
          </select>
          {detailHasData && (
            <span className="text-sm text-zinc-500">
              {plNum(detailTotal)} wejść w okresie {single!.from} – {single!.to}
            </span>
          )}
        </div>

        {loadingSingle && <div className="text-sm text-zinc-500">Ładowanie…</div>}
        {!loadingSingle && !detailHasData && emptyNote}
        {!loadingSingle && detailHasData && (
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Wejścia dziennie" subtitle={`${single!.from} – ${single!.to}`}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={detailDaily} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: '#3f3f46' }} interval="preserveStartEnd" minTickGap={20} />
                  <YAxis tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="visits" fill={SHOWROOM_COLORS[selected]} radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Średni rozkład godzinowy" subtitle={`średnia z okresu ${single!.hourlyFrom} – ${single!.to}`}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={detailHourlyAvg} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: '#3f3f46' }} interval={1} />
                  <YAxis tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="visits" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <div className="lg:col-span-2">
              <ChartCard
                title="Heatmapa godzinowa"
                subtitle={`${single!.hourlyFrom} – ${single!.to} (intensywność = liczba wejść)`}
                action={
                  <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <span>0</span>
                    <span className="h-3 w-3 rounded-[2px]" style={{ backgroundColor: '#27272a' }} />
                    <span className="h-3 w-3 rounded-[2px]" style={{ backgroundColor: 'rgba(59,130,246,0.4)' }} />
                    <span className="h-3 w-3 rounded-[2px]" style={{ backgroundColor: 'rgba(59,130,246,0.7)' }} />
                    <span className="h-3 w-3 rounded-[2px]" style={{ backgroundColor: 'rgba(59,130,246,1)' }} />
                    <span>{plNum(heat.max)}</span>
                  </div>
                }
              >
                <div className="overflow-x-auto">
                  <div className="inline-grid items-center gap-[2px]" style={{ gridTemplateColumns: 'auto repeat(24, 16px)' }}>
                    <div />
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={`h${h}`} className="text-center text-[9px] text-zinc-600">
                        {h}
                      </div>
                    ))}
                    {heat.dates.map((date) => (
                      <Fragment key={date}>
                        <div className="whitespace-nowrap pr-2 text-right text-[9px] text-zinc-500">{date.slice(5)}</div>
                        {heat.byDate.get(date)!.map((v, h) => {
                          const intensity = v / heat.max;
                          return (
                            <div
                              key={`${date}-${h}`}
                              title={`${date} ${String(h).padStart(2, '0')}:00 — ${v} wejść`}
                              className="h-4 w-4 rounded-[2px]"
                              style={{ backgroundColor: v === 0 ? '#27272a' : `rgba(59, 130, 246, ${0.15 + intensity * 0.85})` }}
                            />
                          );
                        })}
                      </Fragment>
                    ))}
                  </div>
                </div>
              </ChartCard>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
