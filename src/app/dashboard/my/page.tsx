'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
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

// Dynamic import — react-grid-layout crashes on SSR (uses DOM APIs)
const GridLayoutDynamic = dynamic(
  () => import('react-grid-layout').then(mod => mod.GridLayout),
  { ssr: false }
);

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

  const handleLayoutChange = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (gridLayout: any) => {
      if (!layout) return;
      const updated = {
        ...layout,
        widgets: layout.widgets.map(w => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const gl = gridLayout.find((g: any) => g.i === w.id);
          if (gl) return { ...w, x: gl.x, y: gl.y, w: gl.w, h: gl.h };
          return w;
        }),
        updatedAt: new Date().toISOString(),
      };
      saveLayout(updated);
    },
    [layout, saveLayout]
  );

  const handleAddWidget = useCallback(
    (type: string) => {
      if (!layout) return;
      const def = getWidgetDef(type);
      if (!def) return;
      const newWidget: WidgetInstance = {
        id: generateWidgetId(),
        type,
        x: 0,
        y: Infinity, // place at bottom
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

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const gridItems = layout.widgets.map(w => ({
    i: w.id,
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
    minW: 2,
    minH: 2,
  }));

  return (
    <div className="space-y-4" ref={containerRef}>
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
        <GridLayoutDynamic
          className="layout"
          layout={gridItems}
          width={containerWidth}
          gridConfig={{ cols: 12, rowHeight: 60, margin: [12, 12] as [number, number] }}
          onLayoutChange={handleLayoutChange}
        >
          {layout.widgets.map(w => (
            <div key={w.id} className="[&>.drag-handle]:cursor-grab">
              <WidgetRenderer
                widgetType={w.type}
                onRemove={() => handleRemoveWidget(w.id)}
              />
            </div>
          ))}
        </GridLayoutDynamic>
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
