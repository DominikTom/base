'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { LayoutDashboard, BarChart3, AlertTriangle, Check } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { addCustomWidgetToDashboard } from '@/lib/dashboard-actions';
import type { Artifact } from '@/lib/assistant/types';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#f97316', '#06b6d4', '#ec4899', '#84cc16', '#14b8a6'];
const AXIS = { fontSize: 11, fill: '#71717a' };
const TOOLTIP = { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', fontSize: '12px' };

const TABLE_PREVIEW_ROWS = 50;

export function ArtifactRenderer({ artifact }: { artifact: Artifact }) {
  if (artifact.type === 'error') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>{artifact.message}</span>
      </div>
    );
  }

  if (artifact.type === 'widget_created') {
    return (
      <Link
        href="/dashboard/my"
        className="flex items-center gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-950/50 transition-colors"
      >
        <LayoutDashboard size={14} className="shrink-0" />
        <span>Dodano widget <strong>{artifact.title}</strong> do dashboardu „{artifact.layoutName}”. Otwórz „Mój Dashboard”.</span>
      </Link>
    );
  }

  if (artifact.type === 'kpi_created') {
    return (
      <Link
        href="/dashboard/kpi"
        className="flex items-center gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-950/50 transition-colors"
      >
        <BarChart3 size={14} className="shrink-0" />
        <span>Dodano KPI <strong>{artifact.name}</strong> (kategoria: {artifact.category}). Otwórz stronę „KPI”.</span>
      </Link>
    );
  }

  if (artifact.type === 'table') {
    const rows = artifact.rows.slice(0, TABLE_PREVIEW_ROWS);
    if (!artifact.columns.length) {
      return <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-500">Zapytanie nie zwróciło wierszy.</div>;
    }
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-auto max-h-80">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-zinc-900">
            <tr className="border-b border-zinc-700">
              {artifact.columns.map(c => (
                <th key={c} className="py-1.5 px-2 text-left text-zinc-400 font-medium whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-zinc-800/30">
                {artifact.columns.map(c => {
                  const v = row[c];
                  return (
                    <td key={c} className="py-1.5 px-2 text-zinc-300 whitespace-nowrap">
                      {typeof v === 'number' ? formatNumber(v) : v == null ? '—' : String(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {(artifact.rows.length > TABLE_PREVIEW_ROWS || artifact.truncated) && (
          <div className="px-3 py-1.5 text-[11px] text-zinc-500 border-t border-zinc-800">
            Pokazano {rows.length} z {artifact.rows.length}{artifact.truncated ? '+ (wynik ucięty do 1000)' : ''} wierszy.
          </div>
        )}
      </div>
    );
  }

  return <ChartArtifact artifact={artifact} />;
}

function ChartArtifact({ artifact }: { artifact: Extract<Artifact, { type: 'chart' }> }) {
  const { chart_type, x_key, series, data, title, query_spec } = artifact;
  const [mode, setMode] = useState<'idle' | 'form' | 'saving' | 'saved'>('idle');
  const [name, setName] = useState(title);
  const [category, setCategory] = useState('Ogólne');
  const [error, setError] = useState<string | null>(null);
  const [dashAdded, setDashAdded] = useState(false);

  async function addToDash() {
    if (!query_spec) return;
    const r = await addCustomWidgetToDashboard(name.trim() || title, query_spec);
    if (r.ok) setDashAdded(true);
  }

  async function saveAsKpi() {
    if (!name.trim() || !query_spec) return;
    setMode('saving');
    setError(null);
    try {
      const res = await fetch('/api/kpi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          category: category.trim() || 'Ogólne',
          tier: 'standard',
          value_type: 'number',
          query_spec,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || `HTTP ${res.status}`); setMode('form'); return; }
      setMode('saved');
    } catch (e) {
      setError(String(e));
      setMode('form');
    }
  }

  const fieldCls = 'px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-xs text-zinc-200';

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="text-xs font-medium text-zinc-300 mb-2">{title}</div>
      <ResponsiveContainer width="100%" height={260}>
        {chart_type === 'pie' ? (
          <PieChart>
            <Pie
              data={data.map(d => ({ name: String(d[x_key]), value: Number(d[series[0]]) || 0 }))}
              dataKey="value"
              nameKey="name"
              outerRadius={90}
              label
            >
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        ) : chart_type === 'line' ? (
          <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey={x_key} tick={AXIS} tickLine={false} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {series.map((s, i) => (
              <Line key={s} type="monotone" dataKey={s} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        ) : chart_type === 'area' ? (
          <AreaChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey={x_key} tick={AXIS} tickLine={false} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {series.map((s, i) => (
              <Area key={s} type="monotone" dataKey={s} stackId="s" stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.5} strokeWidth={2} />
            ))}
          </AreaChart>
        ) : (
          <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey={x_key} tick={AXIS} tickLine={false} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {series.map((s, i) => (
              <Bar key={s} dataKey={s} fill={COLORS[i % COLORS.length]} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>

      {query_spec && (
        <div className="mt-2 pt-2 border-t border-zinc-800">
          {mode === 'saved' ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400">
                <Check size={13} /> Zapisano jako KPI „{name}”.
              </span>
              <Link href="/dashboard/kpi" className="text-[11px] text-blue-400 hover:underline">
                Zakładka KPI
              </Link>
              {dashAdded ? (
                <span className="text-[11px] text-emerald-400">Dodano na dashboard</span>
              ) : (
                <button onClick={addToDash} className="text-[11px] text-blue-400 hover:underline">
                  + Dodaj na dashboard
                </button>
              )}
            </div>
          ) : mode === 'form' || mode === 'saving' ? (
            <div className="flex flex-wrap items-center gap-2">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Nazwa KPI" className={`${fieldCls} flex-1 min-w-[140px]`} />
              <input value={category} onChange={e => setCategory(e.target.value)} placeholder="Kategoria" className={`${fieldCls} w-32`} />
              <button
                onClick={saveAsKpi}
                disabled={mode === 'saving' || !name.trim()}
                className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-50"
              >
                {mode === 'saving' ? 'Zapisywanie…' : 'Zapisz'}
              </button>
              <button onClick={() => setMode('idle')} className="px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300">
                Anuluj
              </button>
              {error && <span className="text-[11px] text-red-400 w-full">{error}</span>}
            </div>
          ) : (
            <button
              onClick={() => setMode('form')}
              className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-blue-400 transition-colors"
            >
              <BarChart3 size={12} /> Zapisz jako KPI
            </button>
          )}
        </div>
      )}
    </div>
  );
}
