'use client';

import { useDashboard } from '@/lib/dashboard-context';
import type { Shop, CompareMode } from '@/types/database';

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
  { value: 'this_month', label: 'Ten mies.' },
  { value: 'prev_month', label: 'Poprz. mies.' },
];

export function Topbar() {
  const { filters, setDateRange, setShop, setCompare, applyPreset } = useDashboard();

  return (
    <header className="sticky top-0 z-30 min-h-16 bg-bg/80 backdrop-blur border-b border-line flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2.5">
      {/* Date presets */}
      <div className="flex items-center gap-1 bg-surface border border-line rounded-pill p-1 shadow-card">
        {PRESETS.map(p => (
          <button
            key={p.value}
            onClick={() => applyPreset(p.value)}
            className="px-3 py-1.5 text-xs font-medium rounded-pill text-fg-soft hover:text-fg hover:bg-bg transition-colors"
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
          className="px-3 py-1.5 text-sm rounded-pill bg-surface border border-line text-fg focus:outline-none focus:ring-2 focus:ring-primary-300 shadow-card"
        />
        <span className="text-muted text-sm">—</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={e => setDateRange(filters.dateFrom, e.target.value)}
          className="px-3 py-1.5 text-sm rounded-pill bg-surface border border-line text-fg focus:outline-none focus:ring-2 focus:ring-primary-300 shadow-card"
        />
      </div>

      {/* Shop selector */}
      <select
        value={filters.shop}
        onChange={e => setShop(e.target.value as Shop)}
        className="px-3 py-1.5 text-sm rounded-pill bg-surface border border-line text-fg focus:outline-none focus:ring-2 focus:ring-primary-300 shadow-card"
      >
        {SHOPS.map(s => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>

      {/* Compare selector */}
      <select
        value={filters.compare}
        onChange={e => setCompare(e.target.value as CompareMode)}
        className="px-3 py-1.5 text-sm rounded-pill bg-surface border border-line text-fg focus:outline-none focus:ring-2 focus:ring-primary-300 shadow-card"
      >
        {COMPARE_OPTIONS.map(c => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
    </header>
  );
}
