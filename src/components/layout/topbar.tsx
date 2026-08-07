'use client';

import { useDashboard } from '@/lib/dashboard-context';
import { shopFilterToList } from '@/lib/shop-filter';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/ui/theme-toggle';

// Sklepy które realnie analizujemy w dashboardzie. Pozostałe (amazon.de,
// allegro.pl, showroom, kaufland.de) są w bazie ale nie pokazujemy ich
// w filtrach — user może wciąż wpisać CSV-string, ale UI ich nie sugeruje.
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
  { value: 'this_month', label: 'Ten mies.' },
  { value: 'prev_month', label: 'Poprz. mies.' },
];

const DATE_INPUT_CLASS =
  'rounded-xl border border-line bg-surface px-2.5 py-1.5 font-mono text-xs text-ink-soft focus:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/10';

export function Topbar() {
  const { filters, setDateRange, setShop, applyPreset } = useDashboard();

  const selected = new Set(shopFilterToList(filters.shop));
  const allSelected = selected.size === 0;

  function toggle(val: string) {
    const next = new Set(selected);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    // 0 / wszystkie zaznaczone → 'all'; 1 → ten sklep; 2+ → CSV.
    if (next.size === 0 || next.size === SHOPS.length) setShop('all');
    else setShop([...next].join(','));
  }

  function setAll() { setShop('all'); }

  return (
    <header className="sticky top-0 z-30 min-h-14 bg-surface/80 backdrop-blur border-b border-line flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
      {/* Date presets */}
      <div className="flex items-center gap-0.5 bg-surface-2 rounded-xl p-1">
        {PRESETS.map(p => (
          <button
            key={p.value}
            onClick={() => applyPreset(p.value)}
            className="px-2.5 py-1 text-xs font-medium rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Date range inputs */}
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={filters.dateFrom}
          onChange={e => setDateRange(e.target.value, filters.dateTo)}
          className={DATE_INPUT_CLASS}
        />
        <span className="text-ink-faint text-sm">—</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={e => setDateRange(filters.dateFrom, e.target.value)}
          className={DATE_INPUT_CLASS}
        />
      </div>

      {/* Shop multi-select (segmenty-checkboxy). Klik = toggle. */}
      <div className="flex items-center gap-0.5 bg-surface-2 rounded-xl p-1">
        <button
          onClick={setAll}
          className={cn(
            'px-2.5 py-1 text-xs font-medium rounded-lg transition-colors',
            allSelected ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink hover:bg-surface'
          )}
        >
          Wszystkie
        </button>
        {SHOPS.map(s => {
          const active = !allSelected && selected.has(s.value);
          return (
            <button
              key={s.value}
              onClick={() => toggle(s.value)}
              className={cn(
                'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors',
                active ? 'bg-primary text-white' : 'text-ink-muted hover:text-ink hover:bg-surface'
              )}
            >
              {active && <Check size={11} />}
              {s.label}
            </button>
          );
        })}
      </div>

      <ThemeToggle variant="segmented" className="ml-auto" />
    </header>
  );
}
