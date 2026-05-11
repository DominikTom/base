'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ChartCard } from '@/components/charts/chart-card';
import { SHOWROOMS, SHOWROOM_LABELS, type Showroom } from '@/lib/sensmax/types';

interface HistResponse {
  showroom: Showroom;
  from: string;
  to: string;
  daily: Array<{ date: string; visits: number; errors: number }>;
  hourly: Array<{ date: string; hour: number; visits: number }>;
  error?: string;
}

const tooltipStyle = { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 } as const;

export function ShowroomCharts() {
  const [showroom, setShowroom] = useState<Showroom>('katowice');
  const [data, setData] = useState<HistResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/sensmax/historical?showroom=${showroom}`)
      .then((r) => r.json())
      .then((j: HistResponse) => {
        if (alive) setData(j.error ? null : j);
      })
      .catch(() => {
        if (alive) setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [showroom]);

  const dailyData = useMemo(() => (data?.daily ?? []).map((d) => ({ name: d.date.slice(5), visits: d.visits })), [data]);

  const hourlyAvg = useMemo(() => {
    const sums = new Array(24).fill(0) as number[];
    const days = new Set<string>();
    for (const h of data?.hourly ?? []) {
      sums[h.hour] += h.visits;
      days.add(h.date);
    }
    const n = Math.max(days.size, 1);
    return sums.map((s, hour) => ({ name: String(hour).padStart(2, '0'), visits: Math.round((s / n) * 10) / 10 }));
  }, [data]);

  const heat = useMemo(() => {
    const byDate = new Map<string, number[]>();
    for (const h of data?.hourly ?? []) {
      if (!byDate.has(h.date)) byDate.set(h.date, new Array(24).fill(0) as number[]);
      byDate.get(h.date)![h.hour] += h.visits;
    }
    const dates = [...byDate.keys()].sort().slice(-21);
    let max = 1;
    for (const d of dates) for (const v of byDate.get(d)!) if (v > max) max = v;
    return { dates, byDate, max };
  }, [data]);

  const totalPeriod = (data?.daily ?? []).reduce((a, d) => a + d.visits, 0);
  const hasData = !!data && data.daily.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="sensmax-showroom" className="text-sm text-zinc-400">
          Showroom:
        </label>
        <select
          id="sensmax-showroom"
          value={showroom}
          onChange={(e) => setShowroom(e.target.value as Showroom)}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
        >
          {SHOWROOMS.map((s) => (
            <option key={s} value={s}>
              {SHOWROOM_LABELS[s]}
            </option>
          ))}
        </select>
        {hasData && (
          <span className="text-sm text-zinc-500">
            {totalPeriod.toLocaleString('pl-PL')} wejść w okresie {data!.from} – {data!.to}
          </span>
        )}
      </div>

      {loading && <div className="text-sm text-zinc-500">Ładowanie…</div>}

      {!loading && !hasData && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-sm text-zinc-400">
          Brak danych historycznych dla tego showroomu. Uruchom synchronizację (<code className="text-zinc-300">POST /api/sensmax/sync</code>)
          albo poczekaj na nocny cron.
        </div>
      )}

      {!loading && hasData && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Wejścia dziennie" subtitle={`${data!.from} – ${data!.to}`}>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={dailyData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717a' }} tickLine={false} axisLine={{ stroke: '#3f3f46' }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="visits" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Średni rozkład godzinowy" subtitle="średnia liczba wejść w danej godzinie">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={hourlyAvg} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717a' }} tickLine={false} axisLine={{ stroke: '#3f3f46' }} interval={1} />
                <YAxis tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="visits" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="lg:col-span-2">
            <ChartCard title="Heatmapa godzinowa" subtitle="ostatnie 21 dni × godziny 0–23 (intensywność = liczba wejść)">
              <div className="overflow-x-auto">
                <div className="inline-grid items-center gap-[2px]" style={{ gridTemplateColumns: `auto repeat(24, 14px)` }}>
                  <div />
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={`h${h}`} className="text-center text-[9px] text-zinc-600">
                      {h}
                    </div>
                  ))}
                  {heat.dates.map((date) => (
                    <Fragment key={date}>
                      <div className="pr-2 text-right text-[9px] text-zinc-500 whitespace-nowrap">{date.slice(5)}</div>
                      {heat.byDate.get(date)!.map((v, h) => {
                        const intensity = v / heat.max;
                        return (
                          <div
                            key={`${date}-${h}`}
                            title={`${date} ${String(h).padStart(2, '0')}:00 — ${v} wejść`}
                            className="h-3.5 w-3.5 rounded-[2px]"
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
  );
}
