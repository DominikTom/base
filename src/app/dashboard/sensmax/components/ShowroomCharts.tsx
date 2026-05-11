'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
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
import { KpiCard } from '@/components/ui/kpi-card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { SHOWROOMS, SHOWROOM_LABELS, SHOWROOM_COLORS, type Showroom, type ShowroomToday } from '@/lib/sensmax/types';

interface SalesAgg {
  orders: number;
  revenue: number;
  bookedOrders: number;
  bookedRevenue: number;
}

interface AllResponse {
  mode: 'all';
  from: string;
  to: string;
  rows: Array<{ showroom: Showroom; date: string; visits: number }>;
  totals: Record<string, number>;
  sales: Array<{ showroom: Showroom; date: string; orders: number; revenue: number; bookedOrders: number; bookedRevenue: number }>;
  salesTotals: Record<string, SalesAgg>;
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
  sales: Array<{ date: string; orders: number; revenue: number; bookedOrders: number; bookedRevenue: number }>;
  error?: string;
}

const tooltipStyle = { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 12 } as const;
const axisTick = { fontSize: 10, fill: '#71717a' } as const;
const plNum = (n: number) => n.toLocaleString('pl-PL');
const plMoney = (n: number) => `${Math.round(n).toLocaleString('pl-PL')} zł`;
const warsawDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date(ms));

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

interface SummaryRow {
  showroom: Showroom;
  label: string;
  visits: number;
  perDay: number;
  orders: number | null;
  conversion: number | null;
  revenue: number | null;
  aov: number | null;
  bestDayVisits: number;
  bestDayDate: string;
}

export function ShowroomCharts() {
  const { filters } = useDashboard();
  const { dateFrom, dateTo } = filters;

  const todayIso = useMemo(() => warsawDay(Date.now()), []);
  const yesterdayIso = useMemo(() => warsawDay(Date.now() - 86_400_000), []);
  const isTodayOnly = dateFrom === dateTo && dateTo === todayIso;
  const rangeLabel = useMemo(() => {
    if (dateFrom === dateTo) {
      if (dateFrom === todayIso) return 'dziś';
      if (dateFrom === yesterdayIso) return 'wczoraj';
      return dateFrom;
    }
    return `${dateFrom} – ${dateTo}`;
  }, [dateFrom, dateTo, todayIso, yesterdayIso]);

  const [selected, setSelected] = useState<Showroom>('katowice');
  const [agg, setAgg] = useState<'daily' | 'weekly'>('daily');
  const [salesBasis, setSalesBasis] = useState<'all' | 'booked'>('all');
  const [hidden, setHidden] = useState<Set<Showroom>>(new Set());

  const [all, setAll] = useState<AllResponse | null>(null);
  const [single, setSingle] = useState<SingleResponse | null>(null);
  const [todayData, setTodayData] = useState<Record<string, ShowroomToday> | null>(null);
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

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch('/api/sensmax/today')
        .then((r) => r.json())
        .then((j) => {
          if (alive && j && !j.error) setTodayData(j as Record<string, ShowroomToday>);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const ordersOf = (t: SalesAgg | undefined) => (t ? (salesBasis === 'booked' ? t.bookedOrders : t.orders) : 0);
  const revenueOf = (t: SalesAgg | undefined) => (t ? (salesBasis === 'booked' ? t.bookedRevenue : t.revenue) : 0);
  const ordersForRow = (r: { orders: number; bookedOrders: number }) => (salesBasis === 'booked' ? r.bookedOrders : r.orders);

  const activeShowrooms = useMemo(() => {
    const totals = all?.totals ?? {};
    const present = new Set((all?.rows ?? []).map((r) => r.showroom));
    return SHOWROOMS.filter((s) => present.has(s) || (totals[s] ?? 0) > 0);
  }, [all]);

  // showrooms that have any sales data in the period
  const salesShowrooms = useMemo(() => {
    const t = all?.salesTotals ?? {};
    return SHOWROOMS.filter((s) => t[s] && (t[s].orders > 0 || t[s].bookedOrders > 0));
  }, [all]);

  // dates with sensor data per showroom (conversion only makes sense on those days)
  const visitDatesByShowroom = useMemo(() => {
    const m = new Map<Showroom, Set<string>>();
    for (const r of all?.rows ?? []) {
      let set = m.get(r.showroom);
      if (!set) {
        set = new Set();
        m.set(r.showroom, set);
      }
      set.add(r.date);
    }
    return m;
  }, [all]);

  // orders on days that also have sensor data, per showroom (matched to current sales basis)
  const ordersOnVisitDays = useMemo(() => {
    const m = new Map<Showroom, number>();
    for (const r of all?.sales ?? []) {
      if (!visitDatesByShowroom.get(r.showroom)?.has(r.date)) continue;
      m.set(r.showroom, (m.get(r.showroom) ?? 0) + (salesBasis === 'booked' ? r.bookedOrders : r.orders));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, visitDatesByShowroom, salesBasis]);

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

  // weekly conversion (orders / visits) per showroom
  const conversionData = useMemo(() => {
    const visitsByWeek = new Map<string, Map<Showroom, number>>();
    const ordersByWeek = new Map<string, Map<Showroom, number>>();
    for (const r of all?.rows ?? []) {
      const w = mondayOf(r.date);
      if (!visitsByWeek.has(w)) visitsByWeek.set(w, new Map());
      const m = visitsByWeek.get(w)!;
      m.set(r.showroom, (m.get(r.showroom) ?? 0) + r.visits);
    }
    for (const r of all?.sales ?? []) {
      const w = mondayOf(r.date);
      if (!ordersByWeek.has(w)) ordersByWeek.set(w, new Map());
      const m = ordersByWeek.get(w)!;
      m.set(r.showroom, (m.get(r.showroom) ?? 0) + ordersForRow(r));
    }
    const weeks = [...new Set([...visitsByWeek.keys(), ...ordersByWeek.keys()])].sort();
    return weeks.map((w) => {
      const point: Record<string, number | string | null> = { name: w.slice(5), _key: w };
      for (const s of salesShowrooms) {
        const v = visitsByWeek.get(w)?.get(s) ?? 0;
        const o = ordersByWeek.get(w)?.get(s) ?? 0;
        point[s] = v > 0 ? Math.round((o / v) * 1000) / 10 : null;
      }
      return point;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, salesShowrooms, salesBasis]);

  const summaryRows = useMemo<SummaryRow[]>(() => {
    const rows = all?.rows ?? [];
    const totals = all?.totals ?? {};
    const salesTotals = all?.salesTotals ?? {};
    return activeShowrooms
      .map((s) => {
        const own = rows.filter((r) => r.showroom === s);
        const visits = totals[s] ?? 0;
        const days = own.length || 1;
        let bestDayVisits = 0;
        let bestDayDate = '—';
        for (const r of own) {
          if (r.visits > bestDayVisits) {
            bestDayVisits = r.visits;
            bestDayDate = r.date;
          }
        }
        const st = salesTotals[s];
        const orders = st ? ordersOf(st) : null;
        const revenue = st ? revenueOf(st) : null;
        const matchedOrders = ordersOnVisitDays.get(s) ?? 0;
        return {
          showroom: s,
          label: SHOWROOM_LABELS[s],
          visits,
          perDay: Math.round((visits / days) * 10) / 10,
          orders,
          conversion: st && visits > 0 ? Math.round((matchedOrders / visits) * 1000) / 10 : st ? 0 : null,
          revenue,
          aov: orders && orders > 0 ? Math.round((revenue ?? 0) / orders) : null,
          bestDayVisits,
          bestDayDate,
        };
      })
      .sort((a, b) => b.visits - a.visits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, activeShowrooms, salesBasis, ordersOnVisitDays]);

  const summaryColumns: Column<SummaryRow>[] = useMemo(
    () => [
      { key: 'label', header: 'Showroom', accessor: (r) => r.label, sortable: true },
      { key: 'visits', header: 'Wejścia', accessor: (r) => r.visits, format: (v) => plNum(Number(v)), align: 'right', sortable: true },
      { key: 'perDay', header: 'Śr. wejść/dzień', accessor: (r) => r.perDay, format: (v) => plNum(Number(v)), align: 'right', sortable: true },
      { key: 'orders', header: 'Zamówienia', accessor: (r) => (r.orders ?? -1), format: (v) => (Number(v) < 0 ? '—' : plNum(Number(v))), align: 'right', sortable: true },
      { key: 'conversion', header: 'Konwersja', accessor: (r) => (r.conversion ?? -1), format: (v) => (Number(v) < 0 ? '—' : `${v}%`), align: 'right', sortable: true },
      { key: 'aov', header: 'AOV', accessor: (r) => (r.aov ?? -1), format: (v) => (Number(v) < 0 ? '—' : plMoney(Number(v))), align: 'right', sortable: true },
      { key: 'revenue', header: 'Przychód', accessor: (r) => (r.revenue ?? -1), format: (v) => (Number(v) < 0 ? '—' : plMoney(Number(v))), align: 'right', sortable: true },
      { key: 'best', header: 'Najlepszy dzień', accessor: (r) => r.bestDayVisits, format: (v) => plNum(Number(v)), align: 'right', sortable: true },
      { key: 'bestDate', header: 'Data', accessor: (r) => r.bestDayDate, align: 'right', sortable: true },
    ],
    [],
  );

  const detailDaily = useMemo(() => {
    const orders = new Map<string, number>();
    for (const r of single?.sales ?? []) orders.set(r.date, (orders.get(r.date) ?? 0) + ordersForRow(r));
    return (single?.daily ?? []).map((d) => ({ name: d.date.slice(5), visits: d.visits, orders: orders.get(d.date) ?? 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single, salesBasis]);
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

  const rangeCoversToday = dateFrom <= todayIso && dateTo >= todayIso;
  const cardFor = (s: Showroom) => {
    const periodTotal = all?.totals?.[s] ?? 0;
    const live = todayData?.[s]?.visitsToday ?? 0;
    const lastEntry = todayData?.[s]?.lastEntryTime ?? null;
    if (isTodayOnly) {
      return { value: live, sub: lastEntry ? `na żywo · ostatnie ${lastEntry.slice(0, 5)}` : 'na żywo · brak ruchu' };
    }
    const todaySynced = (all?.rows ?? []).some((r) => r.showroom === s && r.date === todayIso);
    const addon = rangeCoversToday && !todaySynced ? live : 0;
    const value = periodTotal + addon;
    const st = all?.salesTotals?.[s];
    if (st && periodTotal > 0) {
      const conv = Math.round(((ordersOnVisitDays.get(s) ?? 0) / periodTotal) * 1000) / 10;
      return { value, sub: `konw. ${conv}% · ${plNum(ordersOf(st))} zam. · ${rangeLabel}` };
    }
    return { value, sub: `wejść · ${rangeLabel}` };
  };

  const allHasData = !!all && all.rows.length > 0;
  const detailHasData = !!single && single.daily.length > 0;
  const detailVisits = detailDaily.reduce((a, d) => a + d.visits, 0);
  const detailMatchedOrders = detailDaily.reduce((a, d) => a + d.orders, 0);
  const detailConv = detailVisits > 0 && detailMatchedOrders > 0 ? Math.round((detailMatchedOrders / detailVisits) * 1000) / 10 : null;

  const emptyNote = (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-sm text-zinc-400">
      Brak danych historycznych w tym zakresie. Zmień zakres dat u góry, uruchom synchronizację (
      <code className="text-zinc-300">POST /api/sensmax/sync</code>) lub poczekaj na nocny cron.
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ── Karty: wejścia / konwersja per showroom (zakres globalny) ─────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SHOWROOMS.map((s) => {
          const { value, sub } = cardFor(s);
          return <KpiCard key={s} title={SHOWROOM_LABELS[s]} value={plNum(value)} subLabel={sub} icon={<Users size={16} />} />;
        })}
      </div>

      {/* sales basis toggle */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-400">Zamówienia liczone jako:</span>
        <div className="flex rounded-md border border-zinc-700">
          {(['all', 'booked'] as const).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setSalesBasis(b)}
              className={`px-3 py-1 ${salesBasis === b ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              {b === 'all' ? 'wszystkie' : 'tylko zaksięgowane'}
            </button>
          ))}
        </div>
        <span className="text-zinc-600">konwersja = zamówienia ÷ wejścia (wejścia jak w panelu SensMax — odczyt czujnika ÷ 2)</span>
      </div>

      {/* ── Porównanie wejść ──────────────────────────────────────────────── */}
      <ChartCard
        title="Porównanie wejść"
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
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={compareData} margin={{ top: 5, right: 8, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: '#3f3f46' }} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                {activeShowrooms.map((s) => (
                  <Line key={s} type="monotone" dataKey={s} name={SHOWROOM_LABELS[s]} stroke={SHOWROOM_COLORS[s]} strokeWidth={2} dot={compareData.length <= 1} hide={hidden.has(s)} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </ChartCard>

      {/* ── Konwersja w czasie (tygodniowo) ───────────────────────────────── */}
      {allHasData && salesShowrooms.length > 0 && (
        <ChartCard title="Konwersja w czasie (tygodniowo)" subtitle="zamówienia ÷ wejścia, w ujęciu tygodniowym">
          <div className="mb-3 flex flex-wrap gap-2">
            {salesShowrooms.map((s) => {
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
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={conversionData} margin={{ top: 5, right: 8, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: '#3f3f46' }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={false} unit="%" />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}%`, '']} />
              {salesShowrooms.map((s) => (
                <Line key={s} type="monotone" dataKey={s} name={SHOWROOM_LABELS[s]} stroke={SHOWROOM_COLORS[s]} strokeWidth={2} dot={conversionData.length <= 1} hide={hidden.has(s)} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* ── Zestawienie ───────────────────────────────────────────────────── */}
      {allHasData && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-zinc-200">
            Zestawienie ({all!.from} – {all!.to}) — zamówienia: {salesBasis === 'all' ? 'wszystkie' : 'tylko zaksięgowane'}
          </h3>
          <div className="overflow-x-auto">
            <DataTable data={summaryRows} columns={summaryColumns} onRowClick={(r) => setSelected(r.showroom)} />
          </div>
          <p className="mt-1.5 text-xs text-zinc-500">
            Myślnik w kolumnach sprzedażowych = brak arkusza dla danego showroomu. Konwersja liczona jest tylko z dni, dla których są też dane z czujników
            (arkusze mają zwykle dłuższą historię niż czujniki). Kliknij wiersz, aby zobaczyć szczegóły poniżej.
          </p>
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
              {plNum(detailVisits)} wejść · {plNum(detailMatchedOrders)} zam.{detailConv !== null ? ` · konw. ${detailConv}%` : ''} · {single!.from} – {single!.to}
            </span>
          )}
        </div>

        {loadingSingle && <div className="text-sm text-zinc-500">Ładowanie…</div>}
        {!loadingSingle && !detailHasData && emptyNote}
        {!loadingSingle && detailHasData && (
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Wejścia i zamówienia dziennie" subtitle={`${single!.from} – ${single!.to}`}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={detailDaily} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: '#3f3f46' }} interval="preserveStartEnd" minTickGap={20} />
                  <YAxis tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="visits" name="wejścia" fill={SHOWROOM_COLORS[selected]} radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="orders" name="zamówienia" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={14} />
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
