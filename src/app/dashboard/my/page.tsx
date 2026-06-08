'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDashboard } from '@/lib/dashboard-context';
import { WidgetRenderer } from '@/components/dashboard/widget-renderer';
import { WidgetLibrary } from '@/components/dashboard/widget-library';
import { getWidgetDef } from '@/lib/widget-definitions';
import {
  createDefaultDashboardData,
  migrateToMultiLayout,
  generateWidgetId,
  generateLayoutId,
  type WidgetInstance,
  type DashboardLayout,
  type DashboardData,
} from '@/lib/dashboard-store';
import { Plus, RotateCcw, X, Save, Star, Trash2, Pencil, Check } from 'lucide-react';

const MAX_LAYOUTS = 5;

export default function MyDashboardPage() {
  const { crossFilters, removeCrossFilter, clearCrossFilters } = useDashboard();
  const [dashData, setDashData] = useState<DashboardData | null>(null);
  const [activeLayoutId, setActiveLayoutId] = useState<string>('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [newLayoutName, setNewLayoutName] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Load from DB on mount
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/user');
        if (res.ok) {
          const json = await res.json();
          const raw = json.profile?.dashboard_layout;
          if (raw) {
            const data = migrateToMultiLayout(raw);
            setDashData(data);
            setActiveLayoutId(data.defaultLayoutId || data.layouts[0]?.id || '');
            setMounted(true);
            return;
          }
        }
      } catch { /* fallback */ }
      const data = createDefaultDashboardData();
      setDashData(data);
      setActiveLayoutId(data.defaultLayoutId);
      setMounted(true);
    }
    load();
  }, []);

  const activeLayout = dashData?.layouts.find(l => l.id === activeLayoutId) || dashData?.layouts[0] || null;

  // Persist to DB with feedback
  const saveToDB = useCallback(async (data: DashboardData, showFeedback = false) => {
    if (showFeedback) { setSaveStatus('saving'); setSaveError(null); }
    try {
      const res = await fetch('/api/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_dashboard_data', data }),
      });
      if (res.ok) {
        if (showFeedback) {
          setSaveStatus('saved');
          setHasUnsavedChanges(false);
          setTimeout(() => setSaveStatus('idle'), 2000);
        }
      } else {
        const json = await res.json().catch(() => ({}));
        const msg = json.error || `HTTP ${res.status}`;
        console.error('Dashboard save failed:', msg);
        if (showFeedback) { setSaveStatus('error'); setSaveError(msg); }
      }
    } catch (err) {
      console.error('Dashboard save error:', err);
      if (showFeedback) { setSaveStatus('error'); setSaveError(String(err)); }
    }
  }, []);

  // Update active layout (local state only, marks as unsaved)
  const updateLayout = useCallback((updated: DashboardLayout) => {
    if (!dashData) return;
    const newData: DashboardData = {
      ...dashData,
      layouts: dashData.layouts.map(l => l.id === updated.id ? updated : l),
    };
    setDashData(newData);
    setHasUnsavedChanges(true);
  }, [dashData]);

  const handleAddWidget = useCallback((type: string, config?: Record<string, unknown>) => {
    if (!activeLayout) return;
    const def = getWidgetDef(type);
    if (!def) return;
    const newWidget: WidgetInstance = {
      id: generateWidgetId(),
      type,
      x: 0,
      y: Infinity,
      w: def.defaultSize.w,
      h: def.defaultSize.h,
      config,
    };
    updateLayout({
      ...activeLayout,
      widgets: [...activeLayout.widgets, newWidget],
      updatedAt: new Date().toISOString(),
    });
  }, [activeLayout, updateLayout]);

  const handleRemoveWidget = useCallback((id: string) => {
    if (!activeLayout) return;
    updateLayout({
      ...activeLayout,
      widgets: activeLayout.widgets.filter(w => w.id !== id),
      updatedAt: new Date().toISOString(),
    });
  }, [activeLayout, updateLayout]);

  const handleMove = useCallback((id: string, direction: -1 | 1) => {
    if (!activeLayout) return;
    const widgets = [...activeLayout.widgets];
    const idx = widgets.findIndex(w => w.id === id);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= widgets.length) return;
    [widgets[idx], widgets[newIdx]] = [widgets[newIdx], widgets[idx]];
    updateLayout({ ...activeLayout, widgets, updatedAt: new Date().toISOString() });
  }, [activeLayout, updateLayout]);

  const handleResize = useCallback((id: string, delta: number) => {
    if (!activeLayout) return;
    updateLayout({
      ...activeLayout,
      widgets: activeLayout.widgets.map(w => {
        if (w.id !== id) return w;
        const newW = Math.max(3, Math.min(12, w.w + delta));
        return { ...w, w: newW };
      }),
      updatedAt: new Date().toISOString(),
    });
  }, [activeLayout, updateLayout]);



  // Explicit save button handler
  const handleExplicitSave = useCallback(() => {
    if (!dashData) return;
    saveToDB(dashData, true);
  }, [dashData, saveToDB]);

  // Save current layout as new named layout
  const handleSaveAs = useCallback(() => {
    if (!dashData || !activeLayout || !newLayoutName.trim()) return;
    if (dashData.layouts.length >= MAX_LAYOUTS) return;
    const newLayout: DashboardLayout = {
      id: generateLayoutId(),
      name: newLayoutName.trim(),
      widgets: [...activeLayout.widgets],
      updatedAt: new Date().toISOString(),
    };
    const newData: DashboardData = {
      ...dashData,
      layouts: [...dashData.layouts, newLayout],
    };
    setDashData(newData);
    setActiveLayoutId(newLayout.id);
    saveToDB(newData, true);
    setSaveDialogOpen(false);
    setNewLayoutName('');
  }, [dashData, activeLayout, newLayoutName, saveToDB]);

  // Set as default
  const handleSetDefault = useCallback((layoutId: string) => {
    if (!dashData) return;
    const newData: DashboardData = { ...dashData, defaultLayoutId: layoutId };
    setDashData(newData);
    saveToDB(newData, true);
  }, [dashData, saveToDB]);

  // Delete layout
  const handleDeleteLayout = useCallback((layoutId: string) => {
    if (!dashData || dashData.layouts.length <= 1) return;
    const remaining = dashData.layouts.filter(l => l.id !== layoutId);
    const newDefault = dashData.defaultLayoutId === layoutId ? remaining[0].id : dashData.defaultLayoutId;
    const newData: DashboardData = {
      layouts: remaining,
      defaultLayoutId: newDefault,
    };
    setDashData(newData);
    if (activeLayoutId === layoutId) setActiveLayoutId(remaining[0].id);
    saveToDB(newData, true);
  }, [dashData, activeLayoutId, saveToDB]);

  // Rename layout
  const handleRename = useCallback(() => {
    if (!dashData || !renameId || !renameName.trim()) return;
    const newData: DashboardData = {
      ...dashData,
      layouts: dashData.layouts.map(l =>
        l.id === renameId ? { ...l, name: renameName.trim(), updatedAt: new Date().toISOString() } : l
      ),
    };
    setDashData(newData);
    saveToDB(newData, true);
    setRenameId(null);
    setRenameName('');
  }, [dashData, renameId, renameName, saveToDB]);

  // Reset current layout to defaults
  const handleReset = useCallback(() => {
    if (!activeLayout) return;
    const defaultData = createDefaultDashboardData();
    updateLayout({
      ...activeLayout,
      widgets: defaultData.layouts[0].widgets,
      updatedAt: new Date().toISOString(),
    });
  }, [activeLayout, updateLayout]);

  if (!dashData || !mounted) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-pulse text-zinc-500">Ładowanie dashboardu...</div>
      </div>
    );
  }

  function widgetSpan(w: number): string {
    if (w >= 12) return 'col-span-12';
    if (w >= 8) return 'col-span-12 lg:col-span-8';
    if (w >= 6) return 'col-span-12 md:col-span-6';
    if (w >= 4) return 'col-span-12 sm:col-span-6 lg:col-span-4';
    if (w >= 3) return 'col-span-6 sm:col-span-6 lg:col-span-3';
    return 'col-span-6 lg:col-span-3';
  }

  function widgetHeight(h: number): string {
    if (h <= 2) return 'h-[130px]';
    if (h <= 3) return 'h-[200px]';
    if (h <= 4) return 'h-[280px]';
    if (h <= 5) return 'h-[360px]';
    return 'h-[440px]';
  }

  return (
    <div className="space-y-4">
      {/* Layout tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-800 pb-0">
        {dashData.layouts.map(l => (
          <button
            key={l.id}
            onClick={() => setActiveLayoutId(l.id)}
            className={`group relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              l.id === activeLayoutId
                ? 'bg-zinc-800 text-zinc-100 border border-zinc-700 border-b-zinc-800 -mb-px'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            }`}
          >
            {dashData.defaultLayoutId === l.id && (
              <Star size={12} className="text-amber-500 fill-amber-500" />
            )}
            {l.name}
            {l.id === activeLayoutId && dashData.layouts.length > 1 && (
              <span className="flex items-center gap-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); setRenameId(l.id); setRenameName(l.name); }}
                  className="p-0.5 text-zinc-500 hover:text-zinc-300"
                  title="Zmień nazwę"
                >
                  <Pencil size={10} />
                </button>
                {dashData.defaultLayoutId !== l.id && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSetDefault(l.id); }}
                    className="p-0.5 text-zinc-500 hover:text-amber-400"
                    title="Ustaw jako domyślny"
                  >
                    <Star size={10} />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteLayout(l.id); }}
                  className="p-0.5 text-zinc-500 hover:text-red-400"
                  title="Usuń"
                >
                  <Trash2 size={10} />
                </button>
              </span>
            )}
          </button>
        ))}
        {dashData.layouts.length < MAX_LAYOUTS && (
          <button
            onClick={() => { setSaveDialogOpen(true); setNewLayoutName(''); }}
            className="flex items-center gap-1 px-3 py-2.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            title="Zapisz jako nowy dashboard"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {/* Rename dialog */}
      {renameId && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
          <span className="text-xs text-zinc-400">Nowa nazwa:</span>
          <input
            type="text"
            value={renameName}
            onChange={e => setRenameName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRename()}
            className="px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
          <button onClick={handleRename} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors">
            Zapisz
          </button>
          <button onClick={() => setRenameId(null)} className="px-3 py-1.5 text-zinc-500 hover:text-zinc-300 text-xs">
            Anuluj
          </button>
        </div>
      )}

      {/* Save as dialog */}
      {saveDialogOpen && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
          <Save size={16} className="text-zinc-400" />
          <span className="text-xs text-zinc-400">Nazwa dashboardu:</span>
          <input
            type="text"
            value={newLayoutName}
            onChange={e => setNewLayoutName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveAs()}
            placeholder="np. Marketing, Finanse..."
            className="flex-1 px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
          <button
            onClick={handleSaveAs}
            disabled={!newLayoutName.trim()}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors disabled:opacity-50"
          >
            Zapisz
          </button>
          <button onClick={() => setSaveDialogOpen(false)} className="px-3 py-1.5 text-zinc-500 hover:text-zinc-300 text-xs">
            Anuluj
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">
          {activeLayout?.name || 'Dashboard'}
          {hasUnsavedChanges && <span className="ml-2 text-xs text-amber-500 font-normal">(niezapisane)</span>}
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExplicitSave}
            disabled={saveStatus === 'saving'}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              saveStatus === 'saved'
                ? 'bg-emerald-600 text-white'
                : saveStatus === 'error'
                ? 'bg-red-600 text-white'
                : hasUnsavedChanges
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            {saveStatus === 'saved' ? <Check size={16} /> : <Save size={16} />}
            {saveStatus === 'saving' ? 'Zapisywanie...' : saveStatus === 'saved' ? 'Zapisano!' : saveStatus === 'error' ? 'Błąd zapisu' : 'Zapisz'}
          </button>
          {saveError && (
            <span className="text-[10px] text-red-400 max-w-48 truncate" title={saveError}>{saveError}</span>
          )}
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <RotateCcw size={16} />
            Reset
          </button>
          <button
            onClick={() => setLibraryOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} />
            Dodaj widget
          </button>
        </div>
      </div>

      {/* Active cross-filters */}
      {crossFilters.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap p-3 rounded-lg bg-blue-950/30 border border-blue-800/30">
          <span className="text-xs text-blue-400 font-medium">Filtry:</span>
          {crossFilters.map(cf => (
            <button
              key={`${cf.field}|${cf.value}`}
              onClick={() => removeCrossFilter(cf.field, cf.value)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-600/20 text-blue-300 text-xs hover:bg-blue-600/40 transition-colors"
            >
              {cf.label}
              <X size={12} />
            </button>
          ))}
          <button
            onClick={clearCrossFilters}
            className="text-xs text-zinc-500 hover:text-zinc-300 ml-2"
          >
            Wyczyść wszystkie
          </button>
        </div>
      )}

      {/* Grid */}
      {!activeLayout || activeLayout.widgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-96 gap-4 border-2 border-dashed border-zinc-800 rounded-xl">
          <p className="text-zinc-500">Twój dashboard jest pusty</p>
          <button
            onClick={() => setLibraryOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} />
            Dodaj widgety
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-3">
          {activeLayout.widgets.map((w, i) => (
            <div key={w.id} className={`${widgetSpan(w.w)} ${widgetHeight(w.h)}`}>
              <WidgetRenderer
                widgetType={w.type}
                widgetConfig={w.config}
                onRemove={() => handleRemoveWidget(w.id)}
                onMoveUp={i > 0 ? () => handleMove(w.id, -1) : undefined}
                onMoveDown={i < activeLayout.widgets.length - 1 ? () => handleMove(w.id, 1) : undefined}
                onResize={(delta) => handleResize(w.id, delta)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Widget Library */}
      <WidgetLibrary
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onAdd={handleAddWidget}
      />
    </div>
  );
}
