'use client';

import { useEffect, useState } from 'react';
import { useDashboard } from '@/lib/dashboard-context';
import { ChartCard } from '@/components/charts/chart-card';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { WEATHER_METRICS, type WeatherMetricKey } from '@/lib/weather';
import { CloudRain, Sun, Thermometer, Wind, RefreshCw, Database } from 'lucide-react';
import {
  ComposedChart, Line, Bar, Scatter, ScatterChart,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

interface WeatherResponse {
  shop: string;
  from: string; to: string;
  metric: WeatherMetricKey;
  y: 'revenue' | 'orders';
  series: Array<{ date: string; weather: number | null; revenue: number; orders: number }>;
  stats: {
    weatherMean: number | null;
    weatherMin: number | null;
    weatherMax: number | null;
    totalRevenue: number;
    totalOrders: number;
    correlation: { r: number; n: number; valid: boolean };
  };
  locationKeys: string[];
  error?: string;
}

function correlationLabel(r: number): { label: string; color: string } {
  const abs = Math.abs(r);
  if (abs >= 0.7) return { label: 'silna', color: r > 0 ? 'text-success' : 'text-danger' };
  if (abs >= 0.4) return { label: 'umiarkowana', color: r > 0 ? 'text-success' : 'text-danger' };
  if (abs >= 0.2) return { label: 'słaba', color: 'text-amber-700' };
  return { label: 'brak', color: 'text-muted' };
}

export default function WeatherPage() {
  const { filters } = useDashboard();
  const [metric, setMetric] = useState<WeatherMetricKey>('temp_mean');
  const [yAxis, setYAxis] = useState<'revenue' | 'orders'>('revenue');
  const [data, setData] = useState<WeatherResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // Sync może wykonać tylko admin (server-side guard w /api/jobs/sync-weather).
  // Ukrywamy przycisk dla nie-adminów żeby nie wyświetlał błędu 403.
  const [isAdminUser, setIsAdminUser] = useState(false);
  useEffect(() => {
    fetch('/api/user').then(r => r.ok ? r.json() : null).then(j => {
      setIsAdminUser(j?.profile?.role === 'admin');
    }).catch(() => {});
  }, []);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        shop: filters.shop,
        from: filters.dateFrom,
        to: filters.dateTo,
        metric,
        y: yAxis,
      });
      const res = await fetch(`/api/weather?${params}`);
      const json: WeatherResponse = await res.json();
      setData(json);
    } catch (err) {
      setData(null);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function syncWeather() {
    setSyncing(true); setSyncMsg(null);
    try {
      const params = new URLSearchParams({ from: filters.dateFrom, to: filters.dateTo });
      const res = await fetch(`/api/jobs/sync-weather?${params}`);
      const j = await res.json();
      if (res.ok) {
        const total = Object.values(j.synced as Record<string, number>).reduce((s, v) => s + v, 0);
        setSyncMsg(`Pobrano ${total} dni pogody. Odświeżam dane…`);
        await load();
      } else {
        setSyncMsg(`Błąd: ${j.error || res.status}`);
      }
    } catch (err) {
      setSyncMsg(`Błąd: ${String(err)}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 5000);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filters.shop, filters.dateFrom, filters.dateTo, metric, yAxis]);

  const m = WEATHER_METRICS.find(x => x.key === metric)!;
  const yLabel = yAxis === 'revenue' ? 'Przychód' : 'Zamówienia';
  const yFormat = (v: number) => yAxis === 'revenue' ? formatCurrency(v) : formatNumber(v);
  const wFormat = (v: number) => `${v.toFixed(1)} ${m.unit}`;
  const r = data?.stats.correlation.r ?? 0;
  const corrLbl = correlationLabel(r);
  const scatterData = (data?.series || []).filter(s => s.weather != null).map(s => ({
    x: s.weather,
    y: yAxis === 'revenue' ? s.revenue : s.orders,
    date: s.date,
  }));

  return (
    <div className="space-y-6">
      {/* Nagłówek + sterowanie */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-fg tracking-tight">Pogoda × Sprzedaż</h1>
          <p className="text-sm text-muted mt-1">
            Korelacja dziennej sprzedaży z pogodą. Lokalizacje:
            {' '}{(data?.locationKeys || []).map(k => k === 'warsaw' ? 'Warszawa' : k === 'berlin' ? 'Berlin' : k).join(', ') || '—'}
            {' · '}Open-Meteo (cache 1×/dzień).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={metric} onChange={e => setMetric(e.target.value as WeatherMetricKey)} className="px-3 py-2 rounded-pill bg-surface border border-line text-sm shadow-card">
            {WEATHER_METRICS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <select value={yAxis} onChange={e => setYAxis(e.target.value as 'revenue' | 'orders')} className="px-3 py-2 rounded-pill bg-surface border border-line text-sm shadow-card">
            <option value="revenue">Przychód</option>
            <option value="orders">Zamówienia</option>
          </select>
          {isAdminUser && <button
            onClick={syncWeather}
            disabled={syncing}
            className="flex items-center gap-2 px-3 py-2 rounded-pill bg-accent-bg text-accent-fg text-sm font-medium hover:opacity-90 disabled:opacity-50"
            title="Pobierz brakujące dni z Open-Meteo (tylko admin)"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Synchronizuję…' : 'Sync pogody'}
          </button>}
        </div>
      </div>
      {syncMsg && <div className="text-xs text-fg-soft bg-bg border border-line rounded-pill px-4 py-2 inline-flex">{syncMsg}</div>}

      {loading && !data && <div className="text-muted">Ładowanie…</div>}
      {data?.error && <div className="text-danger bg-rose-50 border border-rose-200 rounded-card p-4">Błąd: {data.error}</div>}
      {data && !data.error && (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiTile
              label="Korelacja Pearsona"
              value={data.stats.correlation.valid ? r.toFixed(3) : '—'}
              sub={data.stats.correlation.valid ? `${corrLbl.label} (${corrLbl.color === 'text-success' ? 'pozytywna' : corrLbl.color === 'text-danger' ? 'negatywna' : 'mieszana'})` : 'za mało danych'}
              valueClassName={corrLbl.color}
              icon={<Database size={16} />}
            />
            <KpiTile
              label={`Średnia ${m.label.toLowerCase()}`}
              value={data.stats.weatherMean != null ? wFormat(data.stats.weatherMean) : '—'}
              sub={data.stats.weatherMin != null && data.stats.weatherMax != null
                ? `min ${wFormat(data.stats.weatherMin)} · max ${wFormat(data.stats.weatherMax)}`
                : ''}
              icon={iconForMetric(metric)}
            />
            <KpiTile
              label="Sprzedaż w okresie"
              value={formatCurrency(data.stats.totalRevenue)}
              sub={`${formatNumber(data.stats.totalOrders)} zamówień`}
              icon={<Database size={16} />}
            />
            <KpiTile
              label="Pokrycie pogodą"
              value={`${data.stats.correlation.n} / ${data.series.length}`}
              sub="dni z danymi pogodowymi"
              icon={<RefreshCw size={16} />}
            />
          </div>

          {/* Dual-axis: weather + sales */}
          <ChartCard title={`${m.label} vs ${yLabel} (dziennie)`} subtitle={`${data.from} → ${data.to}`}>
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={data.series} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EAEBE8" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8B908C' }} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#8B908C' }} tickLine={false} axisLine={false}
                  label={{ value: m.label + ` (${m.unit})`, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#8B908C' } }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#8B908C' }} tickLine={false} axisLine={false}
                  label={{ value: yLabel, angle: 90, position: 'insideRight', style: { fontSize: 11, fill: '#8B908C' } }} />
                <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #ECEDEB', borderRadius: '12px', fontSize: '12px', boxShadow: '0 4px 24px rgba(0,0,0,0.04)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Bar  yAxisId="right" dataKey={yAxis} name={yLabel} fill="#9333EA" fillOpacity={0.85} radius={[4, 4, 0, 0]} />
                <Line yAxisId="left"  dataKey="weather" name={m.label} stroke="#0F1310" strokeWidth={2.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Scatter: weather × sales */}
          <ChartCard title={`Rozrzut: ${m.label} → ${yLabel}`} subtitle={`r = ${r.toFixed(3)} (${corrLbl.label})`}>
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EAEBE8" />
                <XAxis type="number" dataKey="x" name={m.label} tick={{ fontSize: 11, fill: '#8B908C' }}
                  label={{ value: `${m.label} (${m.unit})`, position: 'insideBottom', offset: -5, style: { fontSize: 11, fill: '#8B908C' } }} />
                <YAxis type="number" dataKey="y" name={yLabel} tick={{ fontSize: 11, fill: '#8B908C' }}
                  label={{ value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#8B908C' } }} />
                <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #ECEDEB', borderRadius: '12px', fontSize: '12px', boxShadow: '0 4px 24px rgba(0,0,0,0.04)' }}
                  formatter={(value, name) => {
                    if (name === yLabel) return [yFormat(Number(value)), name];
                    if (name === m.label) return [wFormat(Number(value)), name];
                    return [String(value), String(name ?? '')];
                  }}
                  labelFormatter={() => ''}
                />
                <Scatter data={scatterData} fill="#9333EA" fillOpacity={0.55} />
              </ScatterChart>
            </ResponsiveContainer>
          </ChartCard>
        </>
      )}
    </div>
  );
}

function KpiTile({ label, value, sub, icon, valueClassName }: { label: string; value: string; sub?: string; icon?: React.ReactNode; valueClassName?: string }) {
  return (
    <div className="rounded-card border border-line bg-surface shadow-card p-5 flex flex-col gap-2 hover:shadow-card-hover transition-shadow">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted uppercase tracking-wider">{label}</span>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <div className={`text-2xl font-bold text-fg tracking-tight ${valueClassName || ''}`}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

function iconForMetric(m: WeatherMetricKey): React.ReactNode {
  if (m === 'precip_mm') return <CloudRain size={16} />;
  if (m === 'sunshine_h') return <Sun size={16} />;
  if (m === 'wind_max') return <Wind size={16} />;
  return <Thermometer size={16} />;
}
