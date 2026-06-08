'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, X, Pencil, Trash2, LayoutDashboard, Check } from 'lucide-react';
import { ExplorerQueryBuilder, EMPTY_QUERY_SPEC } from '@/components/dashboard/explorer-query-builder';
import { ChartTypePicker } from '@/components/dashboard/chart-type-picker';
import { PivotBuilder, EMPTY_PIVOT_SPEC } from '@/components/dashboard/pivot-builder';
import { addWidgetToDashboard } from '@/lib/dashboard-actions';
import { WIDGET_CATALOG, type WidgetDefinition } from '@/lib/widget-definitions';
import type { QuerySpec } from '@/lib/explorer-whitelist';

interface KpiDefinition {
  id: string;
  name: string;
  description: string | null;
  category: string;
  tier: string;
  value_type: string;
  query_spec: QuerySpec;
  created_by: string | null;
}

interface KpiDraft {
  name: string;
  description: string;
  category: string;
  tier: string;
  value_type: string;
  query_spec: QuerySpec;
}

const EMPTY_DRAFT: KpiDraft = {
  name: '',
  description: '',
  category: 'Ogólne',
  tier: 'standard',
  value_type: 'number',
  query_spec: EMPTY_QUERY_SPEC,
};

const TIER_BADGE: Record<string, string> = {
  core: 'bg-primary-600/20 text-primary-700 border-blue-700/50',
  standard: 'bg-line/40 text-fg-soft border-line',
  experimental: 'bg-amber-600/20 text-amber-300 border-amber-700/50',
};
const TIER_LABEL: Record<string, string> = { core: 'Core', standard: 'Standard', experimental: 'Eksperymentalne' };
const VALUE_TYPE_LABEL: Record<string, string> = { currency: 'Waluta', number: 'Liczba', percent: 'Procent', ratio: 'Wskaźnik' };

const BUILTIN_ORDER = ['KPI', 'Ranking', 'Wykres', 'Tabela'];

export default function KpiPage() {
  const [kpis, setKpis] = useState<KpiDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tab, setTab] = useState<'basic' | 'query'>('basic');
  const [draft, setDraft] = useState<KpiDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);

  const loadKpis = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/kpi');
      const json = await res.json();
      if (res.ok) setKpis(json.kpis || []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKpis();
    fetch('/api/user')
      .then(r => (r.ok ? r.json() : null))
      .then(j => { setIsAdmin(j?.profile?.role === 'admin'); setUserId(j?.user?.id || null); })
      .catch(() => {});
  }, [loadKpis]);

  function openNew() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setTab('basic');
    setSaveError(null);
    setModalOpen(true);
  }

  function openEdit(k: KpiDefinition) {
    setEditingId(k.id);
    setDraft({
      name: k.name,
      description: k.description || '',
      category: k.category,
      tier: k.tier,
      value_type: k.value_type,
      query_spec: { ...EMPTY_QUERY_SPEC, ...k.query_spec },
    });
    setTab('basic');
    setSaveError(null);
    setModalOpen(true);
  }

  function patchSpec(p: Partial<QuerySpec>) {
    setDraft(d => ({ ...d, query_spec: { ...d.query_spec, ...p } }));
  }

  async function saveKpi() {
    if (!draft.name.trim()) { setSaveError('Podaj nazwę KPI'); setTab('basic'); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(editingId ? `/api/kpi?id=${editingId}` : '/api/kpi', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const json = await res.json();
      if (!res.ok) { setSaveError(json.error || `HTTP ${res.status}`); return; }
      setModalOpen(false);
      loadKpis();
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteKpi(id: string) {
    try {
      const res = await fetch(`/api/kpi?id=${id}`, { method: 'DELETE' });
      if (res.ok) loadKpis();
    } catch { /* ignore */ }
  }

  function flashAdded(id: string) {
    setAddedId(id);
    setTimeout(() => setAddedId(null), 2500);
  }

  async function addKpiToDashboard(k: KpiDefinition) {
    const r = await addWidgetToDashboard('custom_explorer', { title: k.name, ...k.query_spec });
    if (r.ok) flashAdded(k.id);
  }

  async function addBuiltinToDashboard(type: string) {
    const r = await addWidgetToDashboard(type);
    if (r.ok) flashAdded(type);
  }

  const canEdit = (k: KpiDefinition) => isAdmin || (!!userId && k.created_by === userId);
  const categories = [...new Set(kpis.map(k => k.category))].sort();

  const builtinByCat: Record<string, WidgetDefinition[]> = {};
  for (const w of WIDGET_CATALOG) {
    if (w.type === 'custom_explorer') continue;
    if (!builtinByCat[w.category]) builtinByCat[w.category] = [];
    builtinByCat[w.category].push(w);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">KPI i widgety</h1>
          <p className="text-sm text-muted">Twórz i zarządzaj KPI, dodawaj KPI oraz gotowe widgety na dashboard.</p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={16} />
          Nowy KPI
        </button>
      </div>

      {loading ? (
        <div className="text-muted animate-pulse">Ładowanie…</div>
      ) : (
        <>
          {/* Twoje KPI */}
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-fg-soft">Twoje KPI</h2>
            {kpis.length === 0 ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-line px-4 py-5">
                <p className="text-sm text-muted">Nie masz jeszcze własnych KPI.</p>
                <button onClick={openNew} className="flex items-center gap-2 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-xs rounded-lg shrink-0">
                  <Plus size={14} /> Stwórz pierwsze KPI
                </button>
              </div>
            ) : (
              categories.map(cat => (
                <section key={cat} className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">{cat}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {kpis.filter(k => k.category === cat).map(k => (
                      <div key={k.id} className="rounded-xl border border-line bg-surface p-4 flex flex-col gap-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-fg truncate">{k.name}</div>
                            {k.description && <div className="text-xs text-muted mt-0.5 line-clamp-2">{k.description}</div>}
                          </div>
                          <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full border ${TIER_BADGE[k.tier] || TIER_BADGE.standard}`}>
                            {TIER_LABEL[k.tier] || k.tier}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] px-2 py-0.5 rounded bg-bg text-fg-soft">{VALUE_TYPE_LABEL[k.value_type] || k.value_type}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-bg text-fg-soft">{k.query_spec?.chart_type}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-bg text-fg-soft">{k.query_spec?.y_axis}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-auto">
                          <button
                            onClick={() => addKpiToDashboard(k)}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              addedId === k.id ? 'bg-emerald-600 text-white' : 'bg-bg hover:bg-line text-fg'
                            }`}
                          >
                            {addedId === k.id ? <Check size={13} /> : <LayoutDashboard size={13} />}
                            {addedId === k.id ? 'Dodano' : 'Dodaj do dashboardu'}
                          </button>
                          {canEdit(k) && (
                            <>
                              <button onClick={() => openEdit(k)} className="p-1.5 rounded-lg bg-bg hover:bg-line text-fg-soft" title="Edytuj">
                                <Pencil size={13} />
                              </button>
                              <button onClick={() => deleteKpi(k.id)} className="p-1.5 rounded-lg bg-bg hover:bg-red-900/50 text-fg-soft hover:text-danger" title="Usuń">
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>

          {/* Widgety wbudowane */}
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-fg-soft">Widgety wbudowane</h2>
              <p className="text-xs text-muted">Gotowe widgety — kliknij, aby dodać na dashboard. Nie można ich edytować.</p>
            </div>
            {BUILTIN_ORDER.filter(cat => builtinByCat[cat]?.length).map(cat => (
              <section key={cat} className="space-y-2">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">{cat}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {builtinByCat[cat].map(w => (
                    <button
                      key={w.type}
                      onClick={() => addBuiltinToDashboard(w.type)}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        addedId === w.type
                          ? 'border-emerald-700/50 bg-emerald-950/30'
                          : 'border-line bg-surface hover:border-line hover:bg-bg'
                      }`}
                    >
                      <span className="text-sm text-fg truncate">{w.name}</span>
                      <span className={`shrink-0 inline-flex items-center gap-1 text-xs ${addedId === w.type ? 'text-emerald-400' : 'text-muted'}`}>
                        {addedId === w.type ? <><Check size={12} /> Dodano</> : '+ dodaj'}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {/* Modal Nowy / Edytuj KPI */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setModalOpen(false)} />
          <div className="relative w-full max-w-2xl rounded-xl border border-line bg-bg shadow-xl">
            <div className="flex items-center justify-between px-5 py-3 border-b border-line">
              <h2 className="text-sm font-semibold text-fg">{editingId ? 'Edytuj KPI' : 'Nowy KPI'}</h2>
              <button onClick={() => setModalOpen(false)} className="p-1 text-muted hover:text-fg-soft">
                <X size={18} />
              </button>
            </div>

            <div className="flex border-b border-line px-5">
              {(['basic', 'query'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    tab === t ? 'border-primary-500 text-fg' : 'border-transparent text-muted hover:text-fg-soft'
                  }`}
                >
                  {t === 'basic' ? 'Podstawowe' : 'Wykres i dane'}
                </button>
              ))}
            </div>

            <div className="p-5 max-h-[62vh] overflow-y-auto">
              {tab === 'basic' ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted">Nazwa</label>
                    <input
                      value={draft.name}
                      onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                      placeholder="np. Przychód brutto"
                      className="w-full mt-1 px-3 py-2 rounded bg-surface border border-line text-sm text-fg"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted">Opis</label>
                    <textarea
                      value={draft.description}
                      onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                      rows={2}
                      placeholder="Krótki opis wskaźnika"
                      className="w-full mt-1 px-3 py-2 rounded bg-surface border border-line text-sm text-fg resize-none"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-muted">Kategoria</label>
                      <input
                        value={draft.category}
                        onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
                        placeholder="np. Sprzedaż"
                        className="w-full mt-1 px-3 py-2 rounded bg-surface border border-line text-sm text-fg"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted">Poziom (Tier)</label>
                      <select
                        value={draft.tier}
                        onChange={e => setDraft(d => ({ ...d, tier: e.target.value }))}
                        className="w-full mt-1 px-3 py-2 rounded bg-surface border border-line text-sm text-fg"
                      >
                        <option value="core">Core</option>
                        <option value="standard">Standard</option>
                        <option value="experimental">Eksperymentalne</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-muted">Typ wartości</label>
                      <select
                        value={draft.value_type}
                        onChange={e => setDraft(d => ({ ...d, value_type: e.target.value }))}
                        className="w-full mt-1 px-3 py-2 rounded bg-surface border border-line text-sm text-fg"
                      >
                        <option value="currency">Waluta</option>
                        <option value="number">Liczba</option>
                        <option value="percent">Procent</option>
                        <option value="ratio">Wskaźnik</option>
                      </select>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-muted block mb-1.5">Typ wykresu</label>
                    <ChartTypePicker
                      value={draft.query_spec.chart_type}
                      onChange={ct => {
                        // Przełączenie do/z pivota inicjalizuje odpowiedni szkielet specu.
                        if (ct === 'pivot' && draft.query_spec.chart_type !== 'pivot') {
                          setDraft(d => ({ ...d, query_spec: { ...EMPTY_PIVOT_SPEC, filters_advanced: d.query_spec.filters_advanced || [] } }));
                        } else if (ct !== 'pivot' && draft.query_spec.chart_type === 'pivot') {
                          setDraft(d => ({ ...d, query_spec: { ...EMPTY_QUERY_SPEC, chart_type: ct, filters_advanced: d.query_spec.filters_advanced || [] } }));
                        } else {
                          patchSpec({ chart_type: ct });
                        }
                      }}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted block mb-1.5">Dane i filtry</label>
                    {draft.query_spec.chart_type === 'pivot' ? (
                      <PivotBuilder
                        value={draft.query_spec}
                        onChange={qs => setDraft(d => ({ ...d, query_spec: qs }))}
                      />
                    ) : (
                      <ExplorerQueryBuilder
                        value={draft.query_spec}
                        onChange={qs => setDraft(d => ({ ...d, query_spec: qs }))}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-line">
              <span className="text-xs text-danger">{saveError}</span>
              <div className="flex gap-2">
                <button onClick={() => setModalOpen(false)} className="px-3 py-1.5 text-sm text-fg-soft hover:text-fg">
                  Anuluj
                </button>
                <button
                  onClick={saveKpi}
                  disabled={saving}
                  className="px-4 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                >
                  {saving ? 'Zapisywanie…' : 'Zapisz KPI'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
