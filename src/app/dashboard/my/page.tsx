'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { WidgetRenderer } from '@/components/dashboard/widget-renderer';
import { WidgetLibrary } from '@/components/dashboard/widget-library';
import { getWidgetDef } from '@/lib/widget-definitions';
import {
  getOrCreateDefaultLayout,
  saveLayouts,
  loadLayouts,
  generateWidgetId,
  type WidgetInstance,
  type DashboardLayout,
} from '@/lib/dashboard-store';
import { Plus, RotateCcw } from 'lucide-react';

export default function MyDashboardPage() {
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setLayout(getOrCreateDefaultLayout());
    setMounted(true);
  }, []);

  const saveLayout = useCallback((updated: DashboardLayout) => {
    setLayout(updated);
    const all = loadLayouts();
    const idx = all.findIndex(l => l.id === updated.id);
    if (idx >= 0) all[idx] = updated;
    else all.push(updated);
    saveLayouts(all);
  }, []);

  const handleAddWidget = useCallback(
    (type: string) => {
      if (!layout) return;
      const def = getWidgetDef(type);
      if (!def) return;
      const newWidget: WidgetInstance = {
        id: generateWidgetId(),
        type,
        x: 0,
        y: Infinity,
        w: def.defaultSize.w,
        h: def.defaultSize.h,
      };
      saveLayout({
        ...layout,
        widgets: [...layout.widgets, newWidget],
        updatedAt: new Date().toISOString(),
      });
    },
    [layout, saveLayout]
  );

  const handleRemoveWidget = useCallback(
    (id: string) => {
      if (!layout) return;
      saveLayout({
        ...layout,
        widgets: layout.widgets.filter(w => w.id !== id),
        updatedAt: new Date().toISOString(),
      });
    },
    [layout, saveLayout]
  );

  const handleReset = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('mybed_dashboard_layouts');
      localStorage.removeItem('mybed_active_dashboard');
    }
    setLayout(getOrCreateDefaultLayout());
  }, []);

  if (!layout || !mounted) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-pulse text-zinc-500">Ładowanie dashboardu...</div>
      </div>
    );
  }

  // Convert grid units to CSS classes
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">Mój Dashboard</h1>
        <div className="flex items-center gap-2">
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

      {/* Grid */}
      {layout.widgets.length === 0 ? (
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
          {layout.widgets.map(w => (
            <div key={w.id} className={`${widgetSpan(w.w)} ${widgetHeight(w.h)}`}>
              <WidgetRenderer
                widgetType={w.type}
                onRemove={() => handleRemoveWidget(w.id)}
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
