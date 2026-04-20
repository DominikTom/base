'use client';

import { useEffect, useState } from 'react';
import { useDashboard } from '@/lib/dashboard-context';
import { KpiCard } from '@/components/ui/kpi-card';
import { ChartCard } from '@/components/charts/chart-card';
import { SimpleBarChart } from '@/components/charts/bar-chart';
import { SimplePieChart } from '@/components/charts/pie-chart';
import { DataTable, type Column } from '@/components/ui/data-table';
import { formatNumber } from '@/lib/utils';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed,
  Ticket, MessageSquare, Clock, Users, Timer, AlertTriangle,
  CheckCircle, XCircle, Gauge, RefreshCw, Activity, Pause, PhoneCall,
} from 'lucide-react';

interface ThuliumHistory {
  calls: {
    kpis: {
      inbound: number; outbound: number; answered: number; missed: number; abandoned: number;
      answeredRate: number; serviceLevel: number; asa: number; aht: number; abandonRate: number;
    };
    timeline: Array<{ date: string; inbound: number; outbound: number; answered: number; missed: number; abandoned: number }>;
    perQueue: Array<{ name: string; value: number }>;
    waitBuckets: Array<{ name: string; value: number }>;
  };
  tickets: {
    kpis: { total: number; open: number; closed: number; overdue: number; avgFrtSeconds: number; avgTtrSeconds: number };
    byStatus: Array<{ name: string; value: number }>;
    byCategory: Array<{ name: string; value: number }>;
    byQueue: Array<{ name: string; value: number }>;
  };
  chats: {
    kpis: { conversations: number; avgResponseSeconds: number };
    timeline: Array<{ name: string; value: number }>;
  };
  agents: {
    table: Array<{ agent_login: string; logged_hours: number; talk_hours: number; pause_hours: number; calls: number; occupancy: number }>;
    topByCalls: Array<{ name: string; value: number }>;
  };
}

interface ThuliumLive {
  fetchedAt: string;
  summary: { totalWaiting: number; maxEtaSeconds: number; online: number; talking: number; paused: number; offline: number };
  queues: Array<{ id: string; name: string; waiting: number; etaSeconds: number }>;
  agents: Array<{ login: string; name: string; status: string; bucket: 'online' | 'talking' | 'paused' | 'offline' }>;
}

function fmtDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0s';
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export default function ThuliumPage() {
  const { filters } = useDashboard();
  const [data, setData] = useState<ThuliumHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState<ThuliumLive | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchHistory() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ date_from: filters.dateFrom, date_to: filters.dateTo });
        const res = await fetch(`/api/dashboard/thulium?${params}`);
        const json = await res.json();
        if (!cancelled) setData(res.ok ? json : null);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchHistory();
    return () => { cancelled = true; };
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    async function fetchLive() {
      try {
        const res = await fetch('/api/dashboard/thulium/live');
        const json = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setLive(json);
          setLiveError(null);
        } else {
          setLive(null);
          setLiveError(json.error || 'Brak połączenia z Thulium');
        }
      } catch (err) {
        if (!cancelled) setLiveError(String(err));
      }
    }
    fetchLive();
    const id = setInterval(fetchLive, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Obsługa klienta (BOK/CS)</h1>
          <p className="text-xs text-zinc-500 mt-1">Dane z Thulium — live co 30s, historia z ETL ({filters.dateFrom} → {filters.dateTo})</p>
        </div>
        <SyncThuliumButton />
      </div>

      <LiveSection live={live} error={liveError} />

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-pulse text-zinc-500">Ładowanie danych historycznych…</div>
        </div>
      ) : !data ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <p className="text-zinc-400">Brak danych historycznych. Kliknij „Sync Thulium&rdquo; aby pobrać je z API.</p>
        </div>
      ) : (
        <>
          <CallsSection data={data.calls} />
          <TicketsSection data={data.tickets} />
          <ChatsSection data={data.chats} />
          <AgentsSection data={data.agents} />
        </>
      )}
    </div>
  );
}

// ========================= Live =========================

function LiveSection({ live, error }: { live: ThuliumLive | null; error: string | null }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Activity size={16} className="text-emerald-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Live — stan w czasie rzeczywistym</h2>
        {live && <span className="text-xs text-zinc-500">aktualizacja: {new Date(live.fetchedAt).toLocaleTimeString('pl-PL')}</span>}
      </div>

      {error ? (
        <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-4 text-sm text-amber-300">
          <AlertTriangle size={14} className="inline mr-2" />
          {error}
        </div>
      ) : !live ? (
        <div className="text-xs text-zinc-500">Ładowanie…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard title="Oczekujących teraz" value={formatNumber(live.summary.totalWaiting)} icon={<Clock size={18} />} />
            <KpiCard title="Max ETA" value={fmtDuration(live.summary.maxEtaSeconds)} icon={<Timer size={18} />} />
            <KpiCard title="Agenci wolni" value={formatNumber(live.summary.online)} icon={<CheckCircle size={18} />} />
            <KpiCard title="Agenci w rozmowie" value={formatNumber(live.summary.talking)} icon={<PhoneCall size={18} />} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Kolejki — osoby oczekujące">
              <div className="overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900/80 text-zinc-400">
                      <th className="px-4 py-2 text-left font-medium">Kolejka</th>
                      <th className="px-4 py-2 text-right font-medium">Oczekujących</th>
                      <th className="px-4 py-2 text-right font-medium">ETA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.queues.length === 0 ? (
                      <tr><td colSpan={3} className="px-4 py-6 text-center text-zinc-500">Brak kolejek</td></tr>
                    ) : live.queues.map(q => (
                      <tr key={q.id} className="border-b border-zinc-800/50">
                        <td className="px-4 py-2 text-zinc-300">{q.name}</td>
                        <td className="px-4 py-2 text-right text-zinc-200 font-medium">{q.waiting}</td>
                        <td className="px-4 py-2 text-right text-zinc-400">{fmtDuration(q.etaSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>

            <ChartCard title="Agenci — status">
              <div className="grid grid-cols-2 gap-3">
                <LiveAgentStatBox label="Wolni" value={live.summary.online} icon={<CheckCircle size={16} />} color="text-emerald-400" />
                <LiveAgentStatBox label="W rozmowie" value={live.summary.talking} icon={<PhoneCall size={16} />} color="text-blue-400" />
                <LiveAgentStatBox label="Na pauzie" value={live.summary.paused} icon={<Pause size={16} />} color="text-amber-400" />
                <LiveAgentStatBox label="Offline" value={live.summary.offline} icon={<XCircle size={16} />} color="text-zinc-500" />
              </div>
            </ChartCard>
          </div>
        </>
      )}
    </section>
  );
}

function LiveAgentStatBox({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 flex flex-col gap-1">
      <div className={`flex items-center gap-2 text-xs ${color}`}>{icon}{label}</div>
      <div className="text-2xl font-bold text-zinc-100">{value}</div>
    </div>
  );
}

// ========================= Calls =========================

function CallsSection({ data }: { data: ThuliumHistory['calls'] }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Phone size={16} className="text-blue-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Połączenia</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard title="Przychodzące" value={formatNumber(data.kpis.inbound)} icon={<PhoneIncoming size={18} />} />
        <KpiCard title="Odebrane" value={`${data.kpis.answeredRate.toFixed(1)}%`} icon={<CheckCircle size={18} />} />
        <KpiCard title="Nieodebrane" value={formatNumber(data.kpis.missed + data.kpis.abandoned)} icon={<PhoneMissed size={18} />} />
        <KpiCard title="Service Level" value={`${data.kpis.serviceLevel.toFixed(1)}%`} icon={<Gauge size={18} />} />
        <KpiCard title="ASA (śr. oczekiwanie)" value={fmtDuration(data.kpis.asa)} icon={<Timer size={18} />} />
        <KpiCard title="AHT (śr. rozmowa)" value={fmtDuration(data.kpis.aht)} icon={<Clock size={18} />} />
      </div>

      <ChartCard title="Połączenia w czasie" subtitle="Przychodzące / odebrane / nieodebrane / porzucone">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data.timeline} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#71717a' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', fontSize: '12px' }} />
            <Legend />
            <Line type="monotone" dataKey="inbound" name="Przychodzące" stroke="#3b82f6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="answered" name="Odebrane" stroke="#10b981" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="missed" name="Nieodebrane" stroke="#ef4444" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="abandoned" name="Porzucone" stroke="#f59e0b" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Top 10 kolejek — liczba połączeń">
          <SimpleBarChart data={data.perQueue} layout="horizontal" barColor="#3b82f6" />
        </ChartCard>
        <ChartCard title="Rozkład czasu oczekiwania (odebrane)">
          <SimpleBarChart data={data.waitBuckets} barColor="#8b5cf6" />
        </ChartCard>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard title="Wychodzące" value={formatNumber(data.kpis.outbound)} icon={<PhoneOutgoing size={18} />} />
        <KpiCard title="Porzucone" value={formatNumber(data.kpis.abandoned)} icon={<XCircle size={18} />} />
        <KpiCard title="Abandon rate" value={`${data.kpis.abandonRate.toFixed(1)}%`} icon={<AlertTriangle size={18} />} />
        <KpiCard title="Odebrane (liczba)" value={formatNumber(data.kpis.answered)} icon={<CheckCircle size={18} />} />
      </div>
    </section>
  );
}

// ========================= Tickets =========================

function TicketsSection({ data }: { data: ThuliumHistory['tickets'] }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Ticket size={16} className="text-amber-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Zgłoszenia (tickety)</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard title="Wszystkich" value={formatNumber(data.kpis.total)} icon={<Ticket size={18} />} />
        <KpiCard title="Otwartych" value={formatNumber(data.kpis.open)} icon={<AlertTriangle size={18} />} />
        <KpiCard title="Zamkniętych" value={formatNumber(data.kpis.closed)} icon={<CheckCircle size={18} />} />
        <KpiCard title="Zaległych (SLA)" value={formatNumber(data.kpis.overdue)} icon={<XCircle size={18} />} />
        <KpiCard title="Śr. czas 1. odpowiedzi" value={fmtDuration(data.kpis.avgFrtSeconds)} icon={<Timer size={18} />} />
        <KpiCard title="Śr. czas rozwiązania" value={fmtDuration(data.kpis.avgTtrSeconds)} icon={<Clock size={18} />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Tickety wg statusu">
          {data.byStatus.length > 0
            ? <SimplePieChart data={data.byStatus} />
            : <div className="text-xs text-zinc-500 p-8 text-center">Brak danych</div>}
        </ChartCard>
        <ChartCard title="Top kategorie">
          {data.byCategory.length > 0
            ? <SimpleBarChart data={data.byCategory} layout="horizontal" barColor="#f59e0b" />
            : <div className="text-xs text-zinc-500 p-8 text-center">Brak danych</div>}
        </ChartCard>
      </div>

      <ChartCard title="Tickety wg kolejki">
        {data.byQueue.length > 0
          ? <SimpleBarChart data={data.byQueue} barColor="#ef4444" />
          : <div className="text-xs text-zinc-500 p-8 text-center">Brak danych</div>}
      </ChartCard>
    </section>
  );
}

// ========================= Chats =========================

function ChatsSection({ data }: { data: ThuliumHistory['chats'] }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare size={16} className="text-violet-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Czat i e-mail</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KpiCard title="Konwersacje" value={formatNumber(data.kpis.conversations)} icon={<MessageSquare size={18} />} />
        <KpiCard title="Śr. czas odpowiedzi" value={fmtDuration(data.kpis.avgResponseSeconds)} icon={<Timer size={18} />} />
      </div>

      <ChartCard title="Konwersacje w czasie">
        {data.timeline.length > 0
          ? <SimpleBarChart data={data.timeline} barColor="#8b5cf6" />
          : <div className="text-xs text-zinc-500 p-8 text-center">Brak danych</div>}
      </ChartCard>
    </section>
  );
}

// ========================= Agents =========================

function AgentsSection({ data }: { data: ThuliumHistory['agents'] }) {
  const columns: Column<(typeof data.table)[0]>[] = [
    { key: 'agent_login', header: 'Agent', accessor: r => r.agent_login },
    { key: 'logged_hours', header: 'Zalogowany (h)', accessor: r => r.logged_hours, align: 'right' },
    { key: 'talk_hours', header: 'W rozmowie (h)', accessor: r => r.talk_hours, align: 'right' },
    { key: 'pause_hours', header: 'Pauza (h)', accessor: r => r.pause_hours, align: 'right' },
    { key: 'calls', header: 'Połączenia', accessor: r => r.calls, align: 'right', format: v => formatNumber(v as number) },
    { key: 'occupancy', header: 'Occupancy', accessor: r => r.occupancy, align: 'right', format: v => `${(v as number).toFixed(1)}%` },
  ];

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Users size={16} className="text-cyan-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Agenci</h2>
      </div>

      {data.topByCalls.length > 0 && (
        <ChartCard title="Top 5 agentów wg liczby połączeń">
          <SimpleBarChart data={data.topByCalls} layout="horizontal" barColor="#06b6d4" height={220} />
        </ChartCard>
      )}

      <ChartCard title="Raport pracy agentów">
        <DataTable data={data.table} columns={columns} pageSize={15} />
      </ChartCard>
    </section>
  );
}

// ========================= Sync button =========================

function SyncThuliumButton() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSync() {
    setSyncing(true);
    setResult(null);
    try {
      const res = await fetch('/api/etl/thulium-sync', { method: 'POST' });
      const json = await res.json();
      if (res.ok) {
        setResult({ ok: true, message: `Thulium: pobrano ${json.totalRows} wierszy` });
      } else {
        setResult({ ok: false, message: json.error || 'Błąd synchronizacji' });
      }
    } catch (err) {
      setResult({ ok: false, message: String(err) });
    }
    setSyncing(false);
  }

  return (
    <div className="flex items-center gap-3">
      {result && (
        <span className={`text-xs flex items-center gap-1 ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {result.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
          {result.message}
        </span>
      )}
      <button
        onClick={handleSync}
        disabled={syncing}
        className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm rounded-lg transition-colors disabled:opacity-50"
      >
        <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
        {syncing ? 'Sync…' : 'Sync Thulium'}
      </button>
    </div>
  );
}
