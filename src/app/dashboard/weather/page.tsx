'use client';

import { useEffect, useState } from 'react';
import { useDashboard } from '@/lib/dashboard-context';
import { ChartCard } from '@/components/charts/chart-card';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { WEATHER_METRICS, type WeatherMetricKey } from '@/lib/weather';
import { CloudRain, Sun, Thermometer, Wind, RefreshCw, Database, Sparkles } from 'lucide-react';
import {
  ComposedChart, Line, Bar, Scatter, ScatterChart,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

interface WeatherBucket {
  label: string;
  n: number;
  avgIndex: number | null;
  avgRevenue: number;
  pctVsAvg: number | null;
}

interface WeatherResponse {
  shop: string;
  from: string; to: string;
  metric: WeatherMetricKey;
  y: 'revenue' | 'orders';
  series: Array<{
    date: string;
    weather: number | null;
    temp_max: number | null;
    temp_mean: number | null;
    precip_mm: number | null;
    sunshine_h: number | null;
    wind_max: number | null;
    revenue: number;
    orders: number;
  }>;
  stats: {
    weatherMean: number | null;
    weatherMin: number | null;
    weatherMax: number | null;
    totalRevenue: number;
    totalOrders: number;
    correlation: { r: number; n: number; valid: boolean };
    correlationNormalized?: { r: number; n: number; valid: boolean };
  };
  buckets?: {
    precip: WeatherBucket[];
    sunshine: WeatherBucket[];
    temp: WeatherBucket[];
  };
  locationKeys: string[];
  error?: string;
}

// Nakładki pogodowe na główny wykres — każdą można włączyć/wyłączyć
// niezależnie. Kolory celowo SPOZA fioletu (fiolet = sprzedaż/bary).
const OVERLAYS = [
  { key: 'precip_mm',  label: 'Opady',           unit: 'mm',   color: '#2563EB' },  // niebieski — woda
  { key: 'temp_max',   label: 'Temp. max',       unit: '°C',   color: '#E11D48' },  // czerwony — ciepło
  { key: 'temp_mean',  label: 'Temp. średnia',   unit: '°C',   color: '#F97316' },  // pomarańcz
  { key: 'sunshine_h', label: 'Nasłonecznienie', unit: 'h',    color: '#EAB308' },  // żółty — słońce
  { key: 'wind_max',   label: 'Wiatr',           unit: 'km/h', color: '#64748B' },  // szary
] as const;
type OverlayKey = typeof OVERLAYS[number]['key'];

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
  // Aktywne nakładki na głównym wykresie (multi-select).
  const [overlays, setOverlays] = useState<Set<OverlayKey>>(new Set(['precip_mm', 'temp_max', 'sunshine_h']));
  function toggleOverlay(k: OverlayKey) {
    setOverlays(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }
  const [data, setData] = useState<WeatherResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // Podsumowanie AI — generowane z policzonych statystyk (cache 1h server-side).
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
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
        // synced może mieć -1 dla lokacji która padła; sumuje tylko sukcesy.
        const total = Object.values(j.synced as Record<string, number>)
          .filter(v => v > 0).reduce((s, v) => s + v, 0);
        const errs: string[] = Array.isArray(j.errors) ? j.errors : [];
        if (errs.length > 0) {
          setSyncMsg(`Pobrano ${total} dni; ${errs.length} lokacji padło: ${errs.join(' · ')}`);
        } else {
          setSyncMsg(`Pobrano ${total} dni pogody. Odświeżam dane…`);
        }
        await load();
      } else {
        const errs: string[] = Array.isArray(j.errors) ? j.errors : [];
        setSyncMsg(`Błąd: ${j.error || errs.join(' · ') || res.status}`);
      }
    } catch (err) {
      setSyncMsg(`Błąd: ${String(err)}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 8000);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filters.shop, filters.dateFrom, filters.dateTo, metric, yAxis]);

  // Po załadowaniu danych z kubełkami — wygeneruj podsumowanie AI.
  // Liczby są już policzone, LLM tylko formułuje tekst (cache server-side 1h).
  useEffect(() => {
    if (!data || data.error || !data.buckets) { setAiSummary(null); return; }
    let cancelled = false;
    setAiLoading(true);
    const m = WEATHER_METRICS.find(x => x.key === data.metric);
    fetch('/api/weather/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shop: data.shop,
        from: data.from,
        to: data.to,
        y: data.y,
        correlation: data.stats.correlation,
        correlationNormalized: data.stats.correlationNormalized,
        metricLabel: m?.label || data.metric,
        buckets: data.buckets,
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (!cancelled) setAiSummary(j?.summary || null); })
      .catch(() => { if (!cancelled) setAiSummary(null); })
      .finally(() => { if (!cancelled) setAiLoading(false); });
    return () => { cancelled = true; };
  }, [data]);

  const m = WEATHER_METRICS.find(x => x.key === metric)!;
  const yLabel = yAxis === 'revenue' ? 'Przychód' : 'Zamówienia';
  const yFormat = (v: number) => yAxis === 'revenue' ? formatCurrency(v) : formatNumber(v);
  const wFormat = (v: number) => `${v.toFixed(1)} ${m.unit}`;
  const r = data?.stats.correlation.r ?? 0;
  const corrLbl = correlationLabel(r);
  // Korelacja odszumiona (po normalizacji dniem tygodnia) — to jest główny
  // wskaźnik; surowy Pearson topi efekt pogody w sezonowości pon-niedz.
  const rNorm = data?.stats.correlationNormalized?.r ?? null;
  const corrNormLbl = rNorm != null ? correlationLabel(rNorm) : null;
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
              label="Korelacja (bez sezonowości tyg.)"
              value={rNorm != null && data.stats.correlationNormalized?.valid ? rNorm.toFixed(3) : '—'}
              sub={corrNormLbl
                ? `${corrNormLbl.label} · surowa: ${data.stats.correlation.valid ? r.toFixed(3) : '—'}`
                : 'za mało danych'}
              valueClassName={corrNormLbl?.color || corrLbl.color}
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

          {/* Podsumowanie AI — Claude formułuje wnioski z policzonych korelacji
              i kubełków. Subtelny fioletowy gradient jak Wskazówki AI. */}
          {(aiSummary || aiLoading) && (
            <div className="relative overflow-hidden rounded-card border border-line bg-surface shadow-card p-5">
              <div
                aria-hidden
                className="pointer-events-none absolute -top-20 -right-20 w-72 h-72 rounded-full opacity-50"
                style={{ background: 'radial-gradient(circle at center, #E9D5FF 0%, #FAF5FF 50%, transparent 75%)' }}
              />
              <div className="relative flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl bg-accent-bg text-accent-fg flex items-center justify-center shrink-0">
                  <Sparkles size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-fg mb-1">Podsumowanie AI</h3>
                  {aiLoading && !aiSummary ? (
                    <p className="text-sm text-muted animate-pulse">Analizuję korelacje…</p>
                  ) : (
                    <p className="text-sm text-fg-soft leading-relaxed">{aiSummary}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Analiza kubełkowa — średnia sprzedaż per typ pogody, znormalizowana
              dniem tygodnia. Pokazuje nieliniowe efekty których Pearson nie łapie. */}
          {data.buckets && (
            <ChartCard
              title="Sprzedaż wg typu pogody"
              subtitle="Znormalizowane dniem tygodnia — % pokazuje o ile dzień z taką pogodą jest lepszy/gorszy niż typowy taki dzień tygodnia"
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <BucketGroup title="Opady" icon={<CloudRain size={15} />} buckets={data.buckets.precip} />
                <BucketGroup title="Nasłonecznienie" icon={<Sun size={15} />} buckets={data.buckets.sunshine} />
                <BucketGroup title="Temperatura" icon={<Thermometer size={15} />} buckets={data.buckets.temp} />
              </div>
            </ChartCard>
          )}

          {/* Multi-overlay: pogoda (linie) + sprzedaż (bary) */}
          <ChartCard
            title={`Pogoda vs ${yLabel} (dziennie)`}
            subtitle={`${data.from} → ${data.to} · kliknij pillę żeby włączyć/wyłączyć nakładkę`}
            action={
              <div className="flex flex-wrap items-center gap-1.5">
                {OVERLAYS.map(o => {
                  const active = overlays.has(o.key);
                  return (
                    <button
                      key={o.key}
                      onClick={() => toggleOverlay(o.key)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-pill text-[11px] font-medium border transition-colors ${
                        active
                          ? 'border-transparent text-white'
                          : 'border-line bg-bg text-muted hover:text-fg-soft'
                      }`}
                      style={active ? { backgroundColor: o.color } : undefined}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: active ? '#ffffff' : o.color }}
                      />
                      {o.label}
                    </button>
                  );
                })}
              </div>
            }
          >
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart data={data.series} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EAEBE8" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8B908C' }} tickLine={false} />
                {/* Lewa oś wspólna dla nakładek pogodowych — wielkości (°C, mm, h)
                    są w podobnym przedziale 0-30, więc jedna skala wystarcza. */}
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#8B908C' }} tickLine={false} axisLine={false}
                  label={{ value: 'Pogoda (°C / mm / h)', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#8B908C' } }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#8B908C' }} tickLine={false} axisLine={false}
                  label={{ value: yLabel, angle: 90, position: 'insideRight', style: { fontSize: 11, fill: '#8B908C' } }} />
                <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #ECEDEB', borderRadius: '12px', fontSize: '12px', boxShadow: '0 4px 24px rgba(0,0,0,0.04)' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Bar yAxisId="right" dataKey={yAxis} name={yLabel} fill="#9333EA" fillOpacity={0.55} radius={[4, 4, 0, 0]} />
                {OVERLAYS.filter(o => overlays.has(o.key)).map(o => (
                  <Line
                    key={o.key}
                    yAxisId="left"
                    dataKey={o.key}
                    name={`${o.label} (${o.unit})`}
                    stroke={o.color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
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

// Grupa kubełków jednej kategorii pogodowej (np. Opady: sucho/lekki/mocny).
// Pasek = odchylenie od typowego dnia tygodnia; zieleń = lepiej, róż = gorzej.
function BucketGroup({ title, icon, buckets }: { title: string; icon: React.ReactNode; buckets: WeatherBucket[] }) {
  // Skala pasków: max |pct| w grupie (min 10 żeby drobne różnice nie wyglądały dramatycznie)
  const maxAbs = Math.max(10, ...buckets.map(b => Math.abs(b.pctVsAvg ?? 0)));
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3 text-xs font-semibold text-fg-soft uppercase tracking-wider">
        {icon} {title}
      </div>
      <div className="space-y-2.5">
        {buckets.map(b => {
          const pct = b.pctVsAvg;
          const noData = b.n === 0 || pct == null;
          const positive = (pct ?? 0) >= 0;
          const widthPct = noData ? 0 : Math.min(100, (Math.abs(pct!) / maxAbs) * 100);
          return (
            <div key={b.label}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-xs text-fg-soft truncate">{b.label}</span>
                <span className={`text-xs font-semibold tabular-nums shrink-0 ${
                  noData ? 'text-muted' : positive ? 'text-success' : 'text-danger'
                }`}>
                  {noData ? 'brak dni' : `${positive ? '+' : ''}${pct!.toFixed(1)}%`}
                  {!noData && <span className="font-normal text-muted ml-1">({b.n} dni)</span>}
                </span>
              </div>
              <div className="h-2 bg-bg rounded-pill overflow-hidden">
                {!noData && (
                  <div
                    className={`h-full rounded-pill ${positive ? 'bg-green-400' : 'bg-rose-400'}`}
                    style={{ width: `${widthPct}%` }}
                  />
                )}
              </div>
              {!noData && (
                <div className="text-[10px] text-muted mt-0.5">
                  śr. {formatCurrency(b.avgRevenue)}/dzień
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
