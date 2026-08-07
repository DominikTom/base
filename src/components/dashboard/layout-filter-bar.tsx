'use client';

import { Calendar, Store, Check } from 'lucide-react';
import { useDashboard } from '@/lib/dashboard-context';
import { shopFilterToList } from '@/lib/shop-filter';
import { cn } from '@/lib/utils';

// Pasek filtrów per-zakładka dashboardu. Pisze do tego samego DashboardContext
// co globalny topbar, ale `my/page.tsx` automatycznie zapisuje stan kontekstu
// jako snapshot aktywnej zakładki. Wizualnie wyraźnie podkreśla że to
// per-tab — żeby user wiedział że zmiana TU dotyczy tylko tej karty.

const SHOPS = [
  { value: 'mybed.pl', label: 'MyBed.pl' },
  { value: 'mybed.de', label: 'MyBed.de' },
  { value: 'mittohome.pl', label: 'MittoHome.pl' },
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
  // 7d/30d/90d: kończą się WCZORAJ (dziś niepełny), długość: 7/30/90 dni włącznie.
  if (dateTo === yesterday) {
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
  const { filters, setDateRange, setShop, applyPreset } = useDashboard();
  const active = activePreset(filters.dateFrom, filters.dateTo);

  const selectedShops = new Set(shopFilterToList(filters.shop));
  const allShops = selectedShops.size === 0;

  function toggleShop(val: string) {
    const next = new Set(selectedShops);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    if (next.size === 0 || next.size === SHOPS.length) setShop('all');
    else setShop([...next].join(','));
  }

  return (
    <div className="card flex flex-wrap items-center gap-3 p-3">
      <span className="stat-label shrink-0">
        Filtry zakładki
      </span>

      {/* Date presets — pillowy switcher */}
      <div className="flex items-center gap-1 bg-surface-2 rounded-xl p-1">
        {PRESETS.map(p => (
          <button
            key={p.value}
            onClick={() => applyPreset(p.value)}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-lg transition-colors',
              active === p.value
                ? 'bg-primary text-white'
                : 'text-ink-muted hover:text-ink hover:bg-surface',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom date range */}
      <div className="flex items-center gap-2">
        <Calendar size={14} className="text-ink-faint" />
        <input
          type="date"
          value={filters.dateFrom}
          onChange={e => setDateRange(e.target.value, filters.dateTo)}
          className="rounded-xl border border-line bg-surface px-2.5 py-1.5 font-mono text-xs text-ink-soft focus:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/10"
        />
        <span className="text-ink-faint text-sm">—</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={e => setDateRange(filters.dateFrom, e.target.value)}
          className="rounded-xl border border-line bg-surface px-2.5 py-1.5 font-mono text-xs text-ink-soft focus:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/10"
        />
      </div>

      {/* Shop multi-select — pillowe checkboxy */}
      <div className="flex items-center gap-2">
        <Store size={14} className="text-ink-faint" />
        <div className="flex items-center gap-1 bg-surface-2 rounded-xl p-1">
          <button
            onClick={() => setShop('all')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-lg transition-colors',
              allShops ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink hover:bg-surface',
            )}
          >
            Wszystkie
          </button>
          {SHOPS.map(s => {
            const isActive = !allShops && selectedShops.has(s.value);
            return (
              <button
                key={s.value}
                onClick={() => toggleShop(s.value)}
                className={cn(
                  'inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg transition-colors',
                  isActive ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink hover:bg-surface',
                )}
              >
                {isActive && <Check size={11} />}
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Compare dropdown usunięty — porównanie zawsze do poprzedniego okresu */}
    </div>
  );
}
