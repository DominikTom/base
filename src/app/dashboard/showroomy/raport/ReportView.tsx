'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { SHOWROOM_LABELS, SHOWROOM_COLORS, type Showroom } from '@/lib/sensmax/types';

interface Hist {
  showroom: Showroom;
  from: string;
  to: string;
  hourlyFrom: string;
  daily: Array<{ date: string; visits: number; errors: number }>;
  hourly: Array<{ date: string; hour: number; visits: number }>;
  sales: Array<{ date: string; orders: number; revenue: number; bookedOrders: number; bookedRevenue: number }>;
  error?: string;
}

const WEEKDAY_PL = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const WEEKDAY_PL_SHORT = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'so'];
const weekdayIdx = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const dayLabel = (d: string) => `${WEEKDAY_PL_SHORT[weekdayIdx(d)]} ${dm(d)}`;
const plNum = (n: number) => n.toLocaleString('pl-PL');
const plMoney = (n: number) => `${Math.round(n).toLocaleString('pl-PL')} zł`;
const warsawToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());

const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 14mm; }
  body * { visibility: hidden !important; }
  #sm-report, #sm-report * { visibility: visible !important; }
  #sm-report { position: absolute !important; left: 0; top: 0; width: 100%; padding: 0 !important; }
  .no-print { display: none !important; }
}
`;

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-300 bg-white px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold text-zinc-900">{value}</div>
      {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}

export function ReportView({ showroom, from: fromProp, to: toProp }: { showroom: Showroom; from: string; to: string }) {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(toProp) ? toProp : warsawToday();
  const from = useMemo(() => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromProp)) return fromProp;
    const d = new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 29);
    return d.toISOString().slice(0, 10);
  }, [fromProp, to]);

  const [data, setData] = useState<Hist | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/sensmax/historical?showroom=${showroom}&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((j: Hist) => {
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
  }, [showroom, from, to]);

  const m = useMemo(() => {
    const daily = data?.daily ?? [];
    const visitDates = new Set(daily.map((d) => d.date));
    const totalVisits = daily.reduce((a, d) => a + d.visits, 0);
    const days = daily.length || 1;
    const ordersByDate = new Map<string, { o: number; r: number }>();
    for (const s of data?.sales ?? []) {
      const x = ordersByDate.get(s.date) ?? { o: 0, r: 0 };
      x.o += s.orders;
      x.r += s.revenue;
      ordersByDate.set(s.date, x);
    }
    let matchedOrders = 0;
    let matchedRevenue = 0;
    for (const [date, x] of ordersByDate) if (visitDates.has(date)) { matchedOrders += x.o; matchedRevenue += x.r; }
    const totalOrders = [...ordersByDate.values()].reduce((a, x) => a + x.o, 0);
    const totalRevenue = [...ordersByDate.values()].reduce((a, x) => a + x.r, 0);
    const hasSales = (data?.sales?.length ?? 0) > 0;
    const conv = hasSales && totalVisits > 0 ? Math.round((matchedOrders / totalVisits) * 1000) / 10 : null;
    const aov = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : null;

    const dayRows = daily
      .map((d) => ({ date: d.date, visits: d.visits, orders: ordersByDate.get(d.date)?.o ?? 0 }))
      .sort((a, b) => b.visits - a.visits);
    const sums = new Array(24).fill(0) as number[];
    const hdays = new Set<string>();
    for (const h of data?.hourly ?? []) {
      sums[h.hour] += h.visits;
      hdays.add(h.date);
    }
    const hn = Math.max(hdays.size, 1);
    const hourly = sums.map((s, hr) => ({ name: String(hr).padStart(2, '0'), visits: Math.round((s / hn) * 10) / 10 }));

    const dailyChart = daily.map((d) => ({ name: dayLabel(d.date), visits: d.visits, orders: ordersByDate.get(d.date)?.o ?? 0 }));

    // visits by weekday (avg)
    const wdSum = new Array(7).fill(0) as number[];
    const wdCnt = new Array(7).fill(0) as number[];
    for (const d of daily) {
      const i = weekdayIdx(d.date);
      wdSum[i] += d.visits;
      wdCnt[i] += 1;
    }
    const byWeekday = [1, 2, 3, 4, 5, 6, 0].map((i) => ({ name: WEEKDAY_PL_SHORT[i], visits: wdCnt[i] ? Math.round((wdSum[i] / wdCnt[i]) * 10) / 10 : 0 }));

    return {
      totalVisits,
      days,
      perDay: Math.round((totalVisits / days) * 10) / 10,
      totalOrders,
      totalRevenue,
      matchedOrders,
      conv,
      aov,
      hasSales,
      best: dayRows.slice(0, 7),
      hourly,
      dailyChart,
      byWeekday,
      hasData: daily.length > 0,
    };
  }, [data]);

  const generatedAt = useMemo(
    () => new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Warsaw' }).format(new Date()),
    [],
  );
  const color = SHOWROOM_COLORS[showroom];
  const lightTooltip = { backgroundColor: '#ffffff', border: '1px solid #d4d4d8', borderRadius: 8, fontSize: 12, color: '#18181b' } as const;
  const lightAxis = { fontSize: 10, fill: '#52525b' } as const;

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-zinc-100 print:static print:overflow-visible print:bg-white">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="no-print sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-300 bg-white px-6 py-3">
        <button onClick={() => history.back()} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
          ← Wróć
        </button>
        <button onClick={() => window.print()} className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700">
          Pobierz PDF / drukuj
        </button>
        <span className="text-sm text-zinc-500">W oknie drukowania wybierz „Zapisz jako PDF".</span>
      </div>

      <div id="sm-report" className="mx-auto max-w-[820px] bg-white p-8 text-zinc-900 print:p-0">
        {/* header */}
        <div className="mb-6 flex items-end justify-between border-b-2 pb-3" style={{ borderColor: color }}>
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-zinc-500">MyBed Group · Showroom</div>
            <h1 className="text-3xl font-bold">{SHOWROOM_LABELS[showroom]}</h1>
            <div className="text-sm text-zinc-600">
              Raport za okres {from} – {to}
            </div>
          </div>
          <div className="text-right text-[11px] text-zinc-500">wygenerowano: {generatedAt}</div>
        </div>

        {loading && <div className="py-10 text-center text-zinc-500">Ładowanie danych…</div>}
        {!loading && !m.hasData && (
          <div className="rounded-md border border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
            Brak danych z czujników dla tego showroomu w wybranym okresie. Zmień zakres dat na zakładce Showroomy i wygeneruj raport ponownie.
          </div>
        )}

        {!loading && m.hasData && (
          <>
            {/* KPI grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="Wejścia (okres)" value={plNum(m.totalVisits)} sub={`śr. ${plNum(m.perDay)}/dzień · ${m.days} dni`} />
              <Kpi label="Zamówienia" value={m.hasSales ? plNum(m.totalOrders) : '—'} sub={m.hasSales ? `${plNum(m.matchedOrders)} w dniach z czujnikami` : 'brak arkusza sprzedaży'} />
              <Kpi label="Konwersja" value={m.conv !== null ? `${m.conv}%` : '—'} sub="zamówienia ÷ wejścia" />
              <Kpi label="Przychód / AOV" value={m.hasSales ? plMoney(m.totalRevenue) : '—'} sub={m.aov !== null ? `AOV ${plMoney(m.aov)}` : ''} />
            </div>

            {/* daily chart */}
            <h2 className="mt-7 mb-2 text-sm font-semibold text-zinc-700">Wejścia{m.hasSales ? ' i zamówienia' : ''} dziennie</h2>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={m.dailyChart} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis dataKey="name" tick={lightAxis} tickLine={false} axisLine={{ stroke: '#a1a1aa' }} interval="preserveStartEnd" minTickGap={18} />
                <YAxis tick={{ fontSize: 11, fill: '#52525b' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={lightTooltip} />
                <Bar dataKey="visits" name="wejścia" fill={color} radius={[3, 3, 0, 0]} maxBarSize={26} />
                {m.hasSales && <Bar dataKey="orders" name="zamówienia" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={12} />}
              </BarChart>
            </ResponsiveContainer>

            {/* two small charts side by side */}
            <div className="mt-6 grid grid-cols-2 gap-6">
              <div>
                <h2 className="mb-2 text-sm font-semibold text-zinc-700">Średni rozkład godzinowy</h2>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={m.hourly} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                    <XAxis dataKey="name" tick={lightAxis} tickLine={false} axisLine={{ stroke: '#a1a1aa' }} interval={2} />
                    <YAxis tick={{ fontSize: 10, fill: '#52525b' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={lightTooltip} />
                    <Bar dataKey="visits" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={12} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <h2 className="mb-2 text-sm font-semibold text-zinc-700">Średnio wg dnia tygodnia</h2>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={m.byWeekday} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#52525b' }} tickLine={false} axisLine={{ stroke: '#a1a1aa' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#52525b' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={lightTooltip} />
                    <Bar dataKey="visits" fill={color} radius={[3, 3, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* best days table */}
            <h2 className="mt-6 mb-2 text-sm font-semibold text-zinc-700">Najlepsze dni (wg wejść)</h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-300 text-left text-[11px] uppercase tracking-wide text-zinc-500">
                  <th className="py-1.5">Dzień</th>
                  <th className="py-1.5 text-right">Wejścia</th>
                  {m.hasSales && <th className="py-1.5 text-right">Zamówienia</th>}
                  {m.hasSales && <th className="py-1.5 text-right">Konwersja</th>}
                </tr>
              </thead>
              <tbody>
                {m.best.map((d) => (
                  <tr key={d.date} className="border-b border-zinc-100">
                    <td className="py-1.5">
                      {WEEKDAY_PL[weekdayIdx(d.date)]} {d.date}
                    </td>
                    <td className="py-1.5 text-right">{plNum(d.visits)}</td>
                    {m.hasSales && <td className="py-1.5 text-right">{plNum(d.orders)}</td>}
                    {m.hasSales && <td className="py-1.5 text-right">{d.visits > 0 ? `${Math.round((d.orders / d.visits) * 1000) / 10}%` : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-5 text-[10px] leading-relaxed text-zinc-400">
              Wejścia: odczyt czujników SensMax ÷ 2 (czujniki dwukierunkowe — wartości jak w panelu SensMax). Zamówienia i przychód: arkusze sprzedażowe showroomu (kolumna „Data złożenia zamówienia").
              Konwersja liczona z dni, dla których są zarówno wejścia, jak i sprzedaż. Raport wygenerowany automatycznie z panelu MyBed Group.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
