'use client';

import { Calendar, Store, GitCompare } from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import type { Shop, CompareMode } from '@/types/database';
import { cn } from '@/lib/utils';

// Pasek filtrów per-zakładka dashboardu. Pisze do tego samego DashboardContext
// co globalny topbar, ale `my/page.tsx` automatycznie zapisuje stan kontekstu
// jako snapshot aktywnej zakładki. Wizualnie wyraźnie podkreśla że to
// per-tab — żeby user wiedział że zmiana TU dotyczy tylko tej karty.

const SHOPS: { value: Shop; label: string }[] = [
  { value: 'all', label: 'Wszystkie sklepy' },
  { value: 'mybed.pl', label: 'MyBed.pl' },
  { value: 'mybed.de', label: 'MyBed.de' },
  { value: 'mittohome.pl', label: 'MittoHome.pl' },
  { value: 'showroom', label: 'Showroom' },
  { value: 'amazon.de', label: 'Amazon DE' },
  { value: 'allegro.pl', label: 'Allegro PL' },
];

const COMPARE_OPTIONS: { value: CompareMode; label: string }[] = [
  { value: 'none', label: 'Bez porównania' },
  { value: 'previous_period', label: 'Poprzedni okres' },
  { value: 'mom', label: 'Miesiąc do miesiąca' },
  { value: 'yoy', label: 'Rok do roku' },
];

const PRESETS = [
  { value: 'today', label: 'Dziś' },
  { value: 'yesterday', label: 'Wczoraj' },
  { value: '7d', label: '7 dni' },
  { value: '30d', label: '30 dni' },
  { value: '90d', label: '90 dni' },
  { value: 'this_month', label: 'Ten mies.' },
  { value: 'prev_month', label: 'Poprz. mies.' },
];

// Zwraca która preset-etykieta odpowiada aktualnym datom w kontekście — żeby
// podświetlić aktywny preset. Heurystyka po długości zakresu + dacie końca.
function activePreset(dateFrom: string, dateTo: string): string | null {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  if (dateFrom === today && dateTo === today) return 'today';
  if (dateFrom === yesterday && dateTo === yesterday) return 'yesterday';
  const days = Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;
  if (dateTo === today) {
    if (days === 7) return '7d';
    if (days === 30) return '30d';
    if (days === 90) return '90d';
  }
  // this_month: from = 1. dnia miesiąca, to = today
  const thisMonth1 = new Date(); thisMonth1.setDate(1);
  if (dateFrom === thisMonth1.toISOString().split('T')[0] && dateTo === today) return 'this_month';
  return null;
}

export function LayoutFilterBar() {
  const { filters, setDateRange, setShop, setCompare, applyPreset } = useDashboard();
  const active = activePreset(filters.dateFrom, filters.dateTo);

  return (
    <div className="flex flex-wrap items-center gap-3 p-3 rounded-card border border-line bg-surface shadow-card">
      <span className="text-[11px] uppercase tracking-wider font-semibold text-muted shrink-0">
        Filtry zakładki
      </span>

      {/* Date presets — pillowy switcher */}
      <div className="flex items-center gap-1 bg-bg border border-line rounded-pill p-1">
        {PRESETS.map(p => (
          <button
            key={p.value}
            onClick={() => applyPreset(p.value)}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-pill transition-colors',
              active === p.value
                ? 'bg-accent-bg text-accent-fg'
                : 'text-fg-soft hover:text-fg hover:bg-surface',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom date range */}
      <div className="flex items-center gap-2">
        <Calendar size={14} className="text-muted" />
        <input
          type="date"
          value={filters.dateFrom}
          onChange={e => setDateRange(e.target.value, filters.dateTo)}
          className="px-3 py-1.5 text-sm rounded-pill bg-bg border border-line text-fg focus:outline-none focus:ring-2 focus:ring-primary-300"
        />
        <span className="text-muted text-sm">—</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={e => setDateRange(filters.dateFrom, e.target.value)}
          className="px-3 py-1.5 text-sm rounded-pill bg-bg border border-line text-fg focus:outline-none focus:ring-2 focus:ring-primary-300"
        />
      </div>

      {/* Shop */}
      <div className="flex items-center gap-2">
        <Store size={14} className="text-muted" />
        <select
          value={filters.shop}
          onChange={e => setShop(e.target.value as Shop)}
          className="px-3 py-1.5 text-sm rounded-pill bg-bg border border-line text-fg focus:outline-none focus:ring-2 focus:ring-primary-300"
        >
          {SHOPS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {/* Compare */}
      <div className="flex items-center gap-2">
        <GitCompare size={14} className="text-muted" />
        <select
          value={filters.compare}
          onChange={e => setCompare(e.target.value as CompareMode)}
          className="px-3 py-1.5 text-sm rounded-pill bg-bg border border-line text-fg focus:outline-none focus:ring-2 focus:ring-primary-300"
        >
          {COMPARE_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
    </div>
  );
}
