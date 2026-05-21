'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, X, Pencil, Trash2, LayoutDashboard, Check } from 'lucide-react';
import { ExplorerQueryBuilder, EMPTY_QUERY_SPEC } from '@/components/dashboard/explorer-query-builder';
import type { QuerySpec } from '@/lib/explorer-whitelist';
import { getWidgetDef } from '@/lib/widget-definitions';
import {
  migrateToMultiLayout,
  createDefaultDashboardData,
  generateWidgetId,
  type DashboardData,
  type WidgetInstance,
} from '@/lib/dashboard-store';

interface KpiDefinition {
  id: string;
  name: string;
  description: string | null;
  category: string;
  tier: string;
  value_type: string;
  query_spec: QuerySpec;
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
  core: 'bg-blue-600/20 text-blue-300 border-blue-700/50',
  standard: 'bg-zinc-700/40 text-zinc-300 border-zinc-600/50',
  experimental: 'bg-amber-600/20 text-amber-300 border-amber-700/50',
};
const TIER_LABEL: Record<string, string> = { core: 'Core', standard: 'Standard', experimental: 'Eksperymentalne' };
const VALUE_TYPE_LABEL: Record<string, string> = { currency: 'Waluta', number: 'Liczba', percent: 'Procent', ratio: 'Wskaźnik' };

export default function KpiPage() {
  const [kpis, setKpis] = useState<KpiDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

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
      .then(j => setIsAdmin(j?.profile?.role === 'admin'))
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

  // Dodaje KPI jako widget custom_explorer na "Mój Dashboard".
  async function addToDashboard(k: KpiDefinition) {
    try {
      const profileRes = await fetch('/api/user');
      const profileJson = profileRes.ok ? await profileRes.json() : null;
      const raw = profileJson?.profile?.dashboard_layout;
      const dashData: DashboardData = raw ? migrateToMultiLayout(raw) : createDefaultDashboardData();
      const layout = dashData.layouts.find(l => l.id === dashData.defaultLayoutId) || dashData.layouts[0];
      if (!layout) return;

      const def = getWidgetDef('custom_explorer');
      const widget: WidgetInstance = {
        id: generateWidgetId(),
        type: 'custom_explorer',
        x: 0,
        y: Infinity,
        w: def?.defaultSize.w ?? 8,
        h: def?.defaultSize.h ?? 5,
        config: { title: k.name, ...k.query_spec },
      };
      layout.widgets = [...layout.widgets, widget];
      layout.updatedAt = new Date().toISOString();

      const res = await fetch('/api/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_dashboard_data', data: dashData }),
      });
      if (res.ok) {
        setAddedId(k.id);
        setTimeout(() => setAddedId(null), 2500);
      }
    } catch { /* ignore */ }
  }

  const categories = [...new Set(kpis.map(k => k.category))].sort();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">KPI</h1>
          <p className="text-sm text-zinc-500">Wspólny rejestr wskaźników. Dodaj wybrane KPI na swój dashboard.</p>
        </div>
        {isAdmin && (
          <button
            onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} />
            Nowy KPI
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-zinc-500 animate-pulse">Ładowanie KPI…</div>
      ) : kpis.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3 border-2 border-dashed border-zinc-800 rounded-xl">
          <p className="text-zinc-500">Rejestr KPI jest pusty.</p>
          {isAdmin && (
            <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg">
              <Plus size={16} /> Dodaj pierwsze KPI
            </button>
          )}
        </div>
      ) : (
        categories.map(cat => (
          <section key={cat} className="space-y-3">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{cat}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {kpis.filter(k => k.category === cat).map(k => (
                <div key={k.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-100 truncate">{k.name}</div>
                      {k.description && <div className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{k.description}</div>}
                    </div>
                    <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full border ${TIER_BADGE[k.tier] || TIER_BADGE.standard}`}>
                      {TIER_LABEL[k.tier] || k.tier}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">{VALUE_TYPE_LABEL[k.value_type] || k.value_type}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">{k.query_spec?.chart_type}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">{k.query_spec?.y_axis}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-auto">
                    <button
                      onClick={() => addToDashboard(k)}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        addedId === k.id ? 'bg-emerald-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                      }`}
                    >
                      {addedId === k.id ? <Check size={13} /> : <LayoutDashboard size={13} />}
                      {addedId === k.id ? 'Dodano' : 'Dodaj do dashboardu'}
                    </button>
                    {isAdmin && (
                      <>
                        <button onClick={() => openEdit(k)} className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400" title="Edytuj">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => deleteKpi(k.id)} className="p-1.5 rounded-lg bg-zinc-800 hover:bg-red-900/50 text-zinc-400 hover:text-red-300" title="Usuń">
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

      {/* Modal Nowy / Edytuj KPI */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setModalOpen(false)} />
          <div className="relative w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl">
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-100">{editingId ? 'Edytuj KPI' : 'Nowy KPI'}</h2>
              <button onClick={() => setModalOpen(false)} className="p-1 text-zinc-500 hover:text-zinc-300">
                <X size={18} />
              </button>
            </div>

            <div className="flex border-b border-zinc-800 px-5">
              {(['basic', 'query'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    tab === t ? 'border-blue-500 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {t === 'basic' ? 'Podstawowe' : 'Zapytanie'}
                </button>
              ))}
            </div>

            <div className="p-5 max-h-[60vh] overflow-y-auto">
              {tab === 'basic' ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-zinc-500">Nazwa</label>
                    <input
                      value={draft.name}
                      onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                      placeholder="np. Przychód brutto"
                      className="w-full mt-1 px-3 py-2 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-200"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500">Opis</label>
                    <textarea
                      value={draft.description}
                      onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                      rows={2}
                      placeholder="Krótki opis wskaźnika"
                      className="w-full mt-1 px-3 py-2 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 resize-none"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-zinc-500">Kategoria</label>
                      <input
                        value={draft.category}
                        onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
                        placeholder="np. Sprzedaż"
                        className="w-full mt-1 px-3 py-2 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-200"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500">Poziom (Tier)</label>
                      <select
                        value={draft.tier}
                        onChange={e => setDraft(d => ({ ...d, tier: e.target.value }))}
                        className="w-full mt-1 px-3 py-2 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-200"
                      >
                        <option value="core">Core</option>
                        <option value="standard">Standard</option>
                        <option value="experimental">Eksperymentalne</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500">Typ wartości</label>
                      <select
                        value={draft.value_type}
                        onChange={e => setDraft(d => ({ ...d, value_type: e.target.value }))}
                        className="w-full mt-1 px-3 py-2 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-200"
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
                <ExplorerQueryBuilder
                  value={draft.query_spec}
                  onChange={qs => setDraft(d => ({ ...d, query_spec: qs }))}
                />
              )}
            </div>

            <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-zinc-800">
              <span className="text-xs text-red-400">{saveError}</span>
              <div className="flex gap-2">
                <button onClick={() => setModalOpen(false)} className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200">
                  Anuluj
                </button>
                <button
                  onClick={saveKpi}
                  disabled={saving}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
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
