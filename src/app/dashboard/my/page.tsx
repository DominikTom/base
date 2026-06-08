'use client';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Responsive as ResponsiveGridLayout, type Layout, type LayoutItem } from 'react-grid-layout';
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
  type LayoutFilters,
} from '@/lib/dashboard-store';
import type { Shop, CompareMode } from '@/types/database';

import { Plus, RotateCcw, X, Save, Star, Trash2, Pencil, Check } from 'lucide-react';
import { InsightsCard } from '@/components/dashboard/insights-card';
import { LayoutFilterBar } from '@/components/dashboard/layout-filter-bar';

const MAX_LAYOUTS = 5;

export default function MyDashboardPage() {
  const {
    filters: ctxFilters, crossFilters, removeCrossFilter, clearCrossFilters,
    setDateRange, setShop, setCompare,
  } = useDashboard();
  const [dashData, setDashData] = useState<DashboardData | null>(null);
  const [activeLayoutId, setActiveLayoutId] = useState<string>('');
  // Czy aktywujemy zakładkę z filtrami z bazy — wtedy NIE chcemy by
  // ten apply propagował się z powrotem jako „zmiana usera" do zapisu.
  const [applyingFromLayout, setApplyingFromLayout] = useState(false);
  // Szerokość gridu (D&D). Callback ref + useLayoutEffect — wcześniejszy
  // pattern z useRef+useEffect odpalał się raz, na placeholderze loadingu
  // (gdy ref był null), więc nigdy nie łapał faktycznej szerokości po mounted.
  // setState trigger callback ref → effect re-fires → ResizeObserver get się
  // właściwego elementu.
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  useLayoutEffect(() => {
    if (!gridEl) return;
    const update = () => {
      // Mierzymy parent, NIE wrapper — RGL ustawia explicit `width` na swoim
      // root divie, co potrafi „przykryć" rzeczywistą szerokość wrappera
      // i zamrozić pomiar na początkowej wartości.
      const target = gridEl.parentElement ?? gridEl;
      const w = target.getBoundingClientRect().width;
      if (w > 0) setGridWidth(w);
    };
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(gridEl.parentElement ?? gridEl);
    window.addEventListener('resize', update);
    return () => { ro?.disconnect(); window.removeEventListener('resize', update); };
  }, [gridEl]);
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

  // (1) Apply filtrów zakładki do kontekstu przy przełączeniu zakładki.
  // Robi to bez zaznaczania „unsaved changes" — to NIE jest user-edit, tylko
  // odtworzenie zapisanego stanu.
  useEffect(() => {
    if (!mounted || !activeLayout?.filters) return;
    setApplyingFromLayout(true);
    const f = activeLayout.filters;
    setDateRange(f.dateFrom, f.dateTo);
    setShop(f.shop as Shop);
    setCompare(f.compare as CompareMode);
    // Zwolnij flagę po następnym tick — żeby watcher poniżej nie zareagował.
    const t = setTimeout(() => setApplyingFromLayout(false), 0);
    return () => clearTimeout(t);
  }, [activeLayoutId, mounted, activeLayout?.filters, setDateRange, setShop, setCompare]);

  // (2) Watcher: gdy user RĘCZNIE zmienił filtr (topbar), zapisz do bieżącej
  // zakładki jako jej snapshot. Debounce żeby nie spamić save'em przy
  // przesuwaniu daty.
  useEffect(() => {
    if (!mounted || !activeLayout || applyingFromLayout) return;
    const next: LayoutFilters = {
      dateFrom: ctxFilters.dateFrom,
      dateTo: ctxFilters.dateTo,
      shop: ctxFilters.shop,
      compare: ctxFilters.compare,
    };
    const cur = activeLayout.filters;
    if (cur && cur.dateFrom === next.dateFrom && cur.dateTo === next.dateTo && cur.shop === next.shop && cur.compare === next.compare) return;
    const handle = setTimeout(() => {
      updateLayout({ ...activeLayout, filters: next, updatedAt: new Date().toISOString() });
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxFilters.dateFrom, ctxFilters.dateTo, ctxFilters.shop, ctxFilters.compare, mounted, applyingFromLayout, activeLayoutId]);

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
        <div className="animate-pulse text-muted">Ładowanie dashboardu...</div>
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
    <div className="space-y-6">
      {/* AI Wskazówki — nad resztą dashboardu */}
      <InsightsCard />

      {/* Layout tabs */}
      <div className="flex items-center gap-1 border-b border-line pb-0">
        {dashData.layouts.map(l => (
          <button
            key={l.id}
            onClick={() => setActiveLayoutId(l.id)}
            className={`group relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              l.id === activeLayoutId
                ? 'bg-bg text-fg border border-line border-b-zinc-800 -mb-px'
                : 'text-muted hover:text-fg-soft hover:bg-bg'
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
                  className="p-0.5 text-muted hover:text-fg-soft"
                  title="Zmień nazwę"
                >
                  <Pencil size={10} />
                </button>
                {dashData.defaultLayoutId !== l.id && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSetDefault(l.id); }}
                    className="p-0.5 text-muted hover:text-amber-400"
                    title="Ustaw jako domyślny"
                  >
                    <Star size={10} />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteLayout(l.id); }}
                  className="p-0.5 text-muted hover:text-danger"
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
            className="flex items-center gap-1 px-3 py-2.5 text-xs text-muted hover:text-fg-soft transition-colors"
            title="Zapisz jako nowy dashboard"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {/* Per-layout filter bar — daty, sklep, porównanie per zakładka.
          Zmiana tu zapisuje się jako snapshot aktywnej zakładki (debounce w
          watcherze na górze pliku). */}
      <LayoutFilterBar />

      {/* Rename dialog */}
      {renameId && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-bg border border-line">
          <span className="text-xs text-fg-soft">Nowa nazwa:</span>
          <input
            type="text"
            value={renameName}
            onChange={e => setRenameName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRename()}
            className="px-3 py-1.5 rounded bg-surface border border-line text-sm text-fg focus:outline-none focus:ring-2 focus:ring-primary-400"
            autoFocus
          />
          <button onClick={handleRename} className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-xs rounded transition-colors">
            Zapisz
          </button>
          <button onClick={() => setRenameId(null)} className="px-3 py-1.5 text-muted hover:text-fg-soft text-xs">
            Anuluj
          </button>
        </div>
      )}

      {/* Save as dialog */}
      {saveDialogOpen && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-bg border border-line">
          <Save size={16} className="text-fg-soft" />
          <span className="text-xs text-fg-soft">Nazwa dashboardu:</span>
          <input
            type="text"
            value={newLayoutName}
            onChange={e => setNewLayoutName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveAs()}
            placeholder="np. Marketing, Finanse..."
            className="flex-1 px-3 py-1.5 rounded bg-surface border border-line text-sm text-fg placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary-400"
            autoFocus
          />
          <button
            onClick={handleSaveAs}
            disabled={!newLayoutName.trim()}
            className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-xs rounded transition-colors disabled:opacity-50"
          >
            Zapisz
          </button>
          <button onClick={() => setSaveDialogOpen(false)} className="px-3 py-1.5 text-muted hover:text-fg-soft text-xs">
            Anuluj
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-fg">
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
                ? 'bg-primary-600 hover:bg-primary-700 text-white'
                : 'text-fg-soft hover:text-fg hover:bg-bg'
            }`}
          >
            {saveStatus === 'saved' ? <Check size={16} /> : <Save size={16} />}
            {saveStatus === 'saving' ? 'Zapisywanie...' : saveStatus === 'saved' ? 'Zapisano!' : saveStatus === 'error' ? 'Błąd zapisu' : 'Zapisz'}
          </button>
          {saveError && (
            <span className="text-[10px] text-danger max-w-48 truncate" title={saveError}>{saveError}</span>
          )}
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-3 py-2 text-sm text-fg-soft hover:text-fg hover:bg-bg rounded-lg transition-colors"
          >
            <RotateCcw size={16} />
            Reset
          </button>
          <button
            onClick={() => setLibraryOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} />
            Dodaj widget
          </button>
        </div>
      </div>

      {/* Active cross-filters */}
      {crossFilters.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap p-3 rounded-lg bg-primary-50 border border-primary-200">
          <span className="text-xs text-primary-700 font-medium">Filtry:</span>
          {crossFilters.map(cf => (
            <button
              key={`${cf.field}|${cf.value}`}
              onClick={() => removeCrossFilter(cf.field, cf.value)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary-600/20 text-primary-700 text-xs hover:bg-primary-600/40 transition-colors"
            >
              {cf.label}
              <X size={12} />
            </button>
          ))}
          <button
            onClick={clearCrossFilters}
            className="text-xs text-muted hover:text-fg-soft ml-2"
          >
            Wyczyść wszystkie
          </button>
        </div>
      )}

      {/* Grid */}
      {!activeLayout || activeLayout.widgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-96 gap-4 border-2 border-dashed border-line rounded-xl">
          <p className="text-muted">Twój dashboard jest pusty</p>
          <button
            onClick={() => setLibraryOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} />
            Dodaj widgety
          </button>
        </div>
      ) : (
        <div ref={setGridEl} style={{ width: '100%' }}>
        {gridWidth > 0 && <ResponsiveGridLayout
          className="layout"
          width={gridWidth}
          layouts={{
            lg: activeLayout.widgets.map(w => ({ i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: 3, minH: 2 })),
            md: activeLayout.widgets.map(w => ({ i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: 3, minH: 2 })),
            sm: activeLayout.widgets.map(w => ({ i: w.id, x: 0, y: w.y, w: 12, h: w.h, minW: 3, minH: 2 })),
          }}
          breakpoints={{ lg: 1200, md: 996, sm: 0 }}
          cols={{ lg: 12, md: 12, sm: 12 }}
          rowHeight={64}
          margin={[16, 16]}
          containerPadding={[0, 0]}
          dragConfig={{
            enabled: true,
            bounded: false,
            handle: '.widget-drag-handle',
            cancel: '.widget-no-drag',
            threshold: 3,
          }}
          onLayoutChange={(newLayout: Layout) => {
            if (!activeLayout) return;
            const map = new Map<string, LayoutItem>(newLayout.map(l => [l.i, l]));
            let changed = false;
            const newWidgets = activeLayout.widgets.map(w => {
              const l = map.get(w.id);
              if (!l) return w;
              if (l.x !== w.x || l.y !== w.y || l.w !== w.w || l.h !== w.h) {
                changed = true;
                return { ...w, x: l.x, y: l.y, w: l.w, h: l.h };
              }
              return w;
            });
            if (changed) updateLayout({ ...activeLayout, widgets: newWidgets, updatedAt: new Date().toISOString() });
          }}
        >
          {activeLayout.widgets.map(w => (
            <div key={w.id}>
              <WidgetRenderer
                widgetType={w.type}
                widgetConfig={w.config}
                onRemove={() => handleRemoveWidget(w.id)}
                onResize={(delta) => handleResize(w.id, delta)}
              />
            </div>
          ))}
        </ResponsiveGridLayout>}
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
