'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { LayoutDashboard, BarChart3, AlertTriangle, Check } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { useChartTheme, CHART_SERIES } from '@/lib/chart-theme';
import type { Artifact } from '@/lib/assistant/types';

const COLORS = CHART_SERIES;

const TABLE_PREVIEW_ROWS = 50;

export function ArtifactRenderer({ artifact }: { artifact: Artifact }) {
  if (artifact.type === 'error') {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>{artifact.message}</span>
      </div>
    );
  }

  if (artifact.type === 'widget_created') {
    // Legacy artifact (z poprzedniej wersji, gdy create_widget dodawał
    // od razu na dashboard). Nowe sesje używają kpi_created. Zostawiam
    // render, ale kieruje do zakładki KPI — spójnie z nową filozofią.
    return (
      <Link
        href="/dashboard/kpi"
        className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary-soft px-3 py-2 text-xs text-primary-ink hover:bg-primary/10 transition-colors"
      >
        <LayoutDashboard size={14} className="shrink-0" />
        <span>Zapisano widget <strong>{artifact.title}</strong>. Otwórz „KPI", żeby podejrzeć i dodać na dashboard.</span>
      </Link>
    );
  }

  if (artifact.type === 'kpi_created') {
    return (
      <Link
        href="/dashboard/kpi"
        className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 hover:bg-emerald-100 transition-colors"
      >
        <BarChart3 size={14} className="shrink-0" />
        <span>Dodano KPI <strong>{artifact.name}</strong> (kategoria: {artifact.category}). Otwórz stronę „KPI”.</span>
      </Link>
    );
  }

  if (artifact.type === 'table') {
    const rows = artifact.rows.slice(0, TABLE_PREVIEW_ROWS);
    if (!artifact.columns.length) {
      return <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink-muted">Zapytanie nie zwróciło wierszy.</div>;
    }
    return (
      <div className="card overflow-auto max-h-80">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-line">
              {artifact.columns.map(c => (
                <th key={c} className="py-1.5 px-2 text-left text-ink-soft font-medium whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-line hover:bg-surface-2/60">
                {artifact.columns.map(c => {
                  const v = row[c];
                  return (
                    <td key={c} className={`py-1.5 px-2 text-ink-soft whitespace-nowrap${typeof v === 'number' ? ' font-mono' : ''}`}>
                      {typeof v === 'number' ? formatNumber(v) : v == null ? '—' : String(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {(artifact.rows.length > TABLE_PREVIEW_ROWS || artifact.truncated) && (
          <div className="px-3 py-1.5 text-[11px] text-ink-faint border-t border-line">
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
  const chart = useChartTheme();
  // „Opadający" gradient serii; ID gradientu unikalne per instancja (useId)
  const uid = useId().replace(/:/g, '');
  const gradId = (c: string) => `ar-grad-${uid}-${c.replace('#', '')}`;
  const gradDefs = (colors: string[], from: number, to: number) => (
    <defs>
      {[...new Set(colors)].map(c => (
        <linearGradient key={c} id={gradId(c)} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity={from} />
          <stop offset="100%" stopColor={c} stopOpacity={to} />
        </linearGradient>
      ))}
    </defs>
  );
  const xTick = { fontSize: 11, fill: chart.tick };
  const yTick = { fontSize: 11, fill: chart.tickFaint };
  const [mode, setMode] = useState<'idle' | 'form' | 'saving' | 'saved'>('idle');
  const [name, setName] = useState(title);
  const [category, setCategory] = useState('Ogólne');
  const [error, setError] = useState<string | null>(null);

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

  const fieldCls = 'px-2.5 py-1.5 rounded-xl border border-line bg-surface text-xs text-ink-soft focus:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/10';

  const tableColumns = chart_type === 'table' ? [x_key, ...series] : [];
  const tableRows = chart_type === 'table' ? data.slice(0, 100) : [];

  return (
    <div className="card p-3">
      <div className="text-xs font-medium text-ink-soft mb-2">{title}</div>
      {chart_type === 'table' ? (
        <div className="overflow-auto max-h-80 rounded-lg border border-line">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line">
                {tableColumns.map(c => (
                  <th key={c} className="py-1.5 px-2 text-left text-ink-soft font-medium whitespace-nowrap">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, i) => (
                <tr key={i} className="border-b border-line hover:bg-surface-2/60">
                  {tableColumns.map(c => {
                    const v = row[c];
                    return (
                      <td key={c} className={`py-1.5 px-2 text-ink-soft whitespace-nowrap${typeof v === 'number' ? ' font-mono' : ''}`}>
                        {typeof v === 'number' ? formatNumber(v) : v == null ? '—' : String(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {data.length > tableRows.length && (
            <div className="px-3 py-1.5 text-[11px] text-ink-faint border-t border-line">
              Pokazano {tableRows.length} z {data.length} wierszy.
            </div>
          )}
        </div>
      ) : (
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
            <Tooltip contentStyle={chart.tooltip} labelStyle={chart.tooltipLabel} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        ) : chart_type === 'line' ? (
          <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
            <XAxis dataKey={x_key} tick={xTick} tickLine={false} axisLine={{ stroke: chart.axis }} />
            <YAxis tick={yTick} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={chart.tooltip} labelStyle={chart.tooltipLabel} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {series.map((s, i) => (
              <Line key={s} type="monotone" dataKey={s} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        ) : chart_type === 'area' ? (
          <AreaChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
            {gradDefs(series.map((s, i) => COLORS[i % COLORS.length]), 0.5, 0.1)}
            <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
            <XAxis dataKey={x_key} tick={xTick} tickLine={false} axisLine={{ stroke: chart.axis }} />
            <YAxis tick={yTick} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={chart.tooltip} labelStyle={chart.tooltipLabel} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {series.map((s, i) => (
              <Area key={s} type="monotone" dataKey={s} stackId="s" stroke={COLORS[i % COLORS.length]} fill={`url(#${gradId(COLORS[i % COLORS.length])})`} strokeWidth={2} />
            ))}
          </AreaChart>
        ) : (
          <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
            {gradDefs(series.map((s, i) => COLORS[i % COLORS.length]), 1, 0.35)}
            <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
            <XAxis dataKey={x_key} tick={xTick} tickLine={false} axisLine={{ stroke: chart.axis }} />
            <YAxis tick={yTick} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={chart.tooltip} labelStyle={chart.tooltipLabel} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {series.map((s, i) => (
              <Bar key={s} dataKey={s} fill={`url(#${gradId(COLORS[i % COLORS.length])})`} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
      )}

      {query_spec && (
        <div className="mt-2 pt-2 border-t border-line">
          {mode === 'saved' ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-600">
                <Check size={13} /> Zapisano jako KPI „{name}”.
              </span>
              <Link href="/dashboard/kpi" className="text-[11px] text-primary-ink hover:underline font-medium">
                → Otwórz w zakładce KPI (edytuj, dodaj na dashboard)
              </Link>
            </div>
          ) : mode === 'form' || mode === 'saving' ? (
            <div className="flex flex-wrap items-center gap-2">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Nazwa KPI" className={`${fieldCls} flex-1 min-w-[140px]`} />
              <input value={category} onChange={e => setCategory(e.target.value)} placeholder="Kategoria" className={`${fieldCls} w-32`} />
              <button
                onClick={saveAsKpi}
                disabled={mode === 'saving' || !name.trim()}
                className="btn-primary px-3 py-1.5 text-xs"
              >
                {mode === 'saving' ? 'Zapisywanie…' : 'Zapisz'}
              </button>
              <button onClick={() => setMode('idle')} className="px-2 py-1.5 text-xs text-ink-muted hover:text-ink transition-colors">
                Anuluj
              </button>
              {error && <span className="text-[11px] text-red-600 w-full">{error}</span>}
            </div>
          ) : (
            <button
              onClick={() => setMode('form')}
              className="inline-flex items-center gap-1.5 text-[11px] text-ink-soft hover:text-primary-ink transition-colors"
            >
              <BarChart3 size={12} /> Zapisz jako KPI
            </button>
          )}
        </div>
      )}
    </div>
  );
}
