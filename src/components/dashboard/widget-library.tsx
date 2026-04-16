'use client';

import { WIDGET_CATALOG, type WidgetDefinition } from '@/lib/widget-definitions';
import { X, BarChart3, Hash, TrendingUp, Table } from 'lucide-react';

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  KPI: <Hash size={14} />,
  Ranking: <BarChart3 size={14} />,
  Wykres: <TrendingUp size={14} />,
  Tabela: <Table size={14} />,
};

const CATEGORY_ORDER = ['KPI', 'Ranking', 'Wykres', 'Tabela'];

interface WidgetLibraryProps {
  open: boolean;
  onClose: () => void;
  onAdd: (type: string) => void;
}

export function WidgetLibrary({ open, onClose, onAdd }: WidgetLibraryProps) {
  if (!open) return null;

  const grouped: Record<string, WidgetDefinition[]> = {};
  for (const w of WIDGET_CATALOG) {
    if (!grouped[w.category]) grouped[w.category] = [];
    grouped[w.category].push(w);
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-80 h-full bg-zinc-950 border-l border-zinc-800 overflow-y-auto">
        <div className="sticky top-0 bg-zinc-950 border-b border-zinc-800 px-4 py-3 flex items-center justify-between z-10">
          <h2 className="text-sm font-semibold text-zinc-200">Biblioteka widgetów</h2>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-300">
            <X size={18} />
          </button>
        </div>

        <div className="p-3 space-y-4">
          {CATEGORY_ORDER.map(cat => (
            <div key={cat}>
              <div className="flex items-center gap-2 px-1 mb-2">
                <span className="text-zinc-500">{CATEGORY_ICONS[cat]}</span>
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{cat}</span>
              </div>
              <div className="space-y-1">
                {(grouped[cat] || []).map(w => (
                  <button
                    key={w.type}
                    onClick={() => { onAdd(w.type); onClose(); }}
                    className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-zinc-300 hover:bg-zinc-800/70 hover:text-zinc-100 transition-colors flex items-center justify-between group"
                  >
                    <span>{w.name}</span>
                    <span className="text-xs text-zinc-600 group-hover:text-blue-400">+ dodaj</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
