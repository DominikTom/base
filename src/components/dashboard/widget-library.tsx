'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { WIDGET_CATALOG, type WidgetDefinition } from '@/lib/widget-definitions';
import { X, BarChart3, Hash, TrendingUp, Table, Target, Plus } from 'lucide-react';
import type { QuerySpec } from '@/lib/explorer-whitelist';

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  KPI: <Hash size={14} />,
  Ranking: <BarChart3 size={14} />,
  Wykres: <TrendingUp size={14} />,
  Tabela: <Table size={14} />,
};

const CATEGORY_ORDER = ['KPI', 'Ranking', 'Wykres', 'Tabela'];

interface KpiDefinition {
  id: string;
  name: string;
  category: string;
  query_spec: QuerySpec;
}

interface WidgetLibraryProps {
  open: boolean;
  onClose: () => void;
  onAdd: (type: string, config?: Record<string, unknown>) => void;
}

export function WidgetLibrary({ open, onClose, onAdd }: WidgetLibraryProps) {
  const [kpis, setKpis] = useState<KpiDefinition[]>([]);

  useEffect(() => {
    if (!open) return;
    fetch('/api/kpi')
      .then(r => (r.ok ? r.json() : null))
      .then(j => setKpis(j?.kpis || []))
      .catch(() => {});
  }, [open]);

  if (!open) return null;

  // custom_explorer nie jest dodawany ręcznie z biblioteki — powstaje z KPI.
  const grouped: Record<string, WidgetDefinition[]> = {};
  for (const w of WIDGET_CATALOG) {
    if (w.type === 'custom_explorer') continue;
    if (!grouped[w.category]) grouped[w.category] = [];
    grouped[w.category].push(w);
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative ml-auto w-80 h-full bg-bg border-l border-line overflow-y-auto">
        <div className="sticky top-0 bg-bg border-b border-line px-4 py-3 flex items-center justify-between z-10">
          <h2 className="text-sm font-semibold text-fg">Dodaj widget</h2>
          <button onClick={onClose} className="p-1 text-muted hover:text-fg-soft">
            <X size={18} />
          </button>
        </div>

        <div className="p-3 space-y-5">
          {/* KPI z katalogu */}
          <div>
            <div className="flex items-center gap-2 px-1 mb-2">
              <span className="text-muted"><Target size={14} /></span>
              <span className="text-xs font-semibold text-fg-soft uppercase tracking-wider">Twoje KPI</span>
            </div>
            <div className="space-y-1">
              {kpis.map(k => (
                <button
                  key={k.id}
                  onClick={() => { onAdd('custom_explorer', { title: k.name, ...k.query_spec }); onClose(); }}
                  className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-fg-soft hover:bg-bg hover:text-fg transition-colors flex items-center justify-between group"
                >
                  <span className="truncate">{k.name}</span>
                  <span className="text-xs text-muted group-hover:text-primary-700 shrink-0 ml-2">+ dodaj</span>
                </button>
              ))}
              {kpis.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted">Brak KPI w katalogu.</p>
              )}
              <Link
                href="/dashboard/kpi"
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-primary-700 hover:bg-primary-600/10 transition-colors"
              >
                <Plus size={14} />
                Stwórz nowe KPI
              </Link>
            </div>
          </div>

          {/* Widgety predefiniowane */}
          {CATEGORY_ORDER.map(cat => (
            (grouped[cat] || []).length > 0 && (
              <div key={cat}>
                <div className="flex items-center gap-2 px-1 mb-2">
                  <span className="text-muted">{CATEGORY_ICONS[cat]}</span>
                  <span className="text-xs font-semibold text-fg-soft uppercase tracking-wider">{cat}</span>
                </div>
                <div className="space-y-1">
                  {grouped[cat].map(w => (
                    <button
                      key={w.type}
                      onClick={() => { onAdd(w.type); onClose(); }}
                      className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-fg-soft hover:bg-bg hover:text-fg transition-colors flex items-center justify-between group"
                    >
                      <span>{w.name}</span>
                      <span className="text-xs text-muted group-hover:text-primary-700">+ dodaj</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          ))}
        </div>
      </div>
    </div>
  );
}
