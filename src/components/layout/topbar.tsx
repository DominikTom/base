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
    <header className="sticky top-0 z-30 min-h-16 bg-zinc-950/80 backdrop-blur border-b border-zinc-800 flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2">
      {/* Date presets */}
      <div className="flex items-center gap-1 bg-zinc-900 rounded-lg p-1">
        {PRESETS.map(p => (
          <button
            key={p.value}
            onClick={() => applyPreset(p.value)}
            className="px-2.5 py-1.5 text-xs font-medium rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
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
          className="px-3 py-1.5 text-sm rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <span className="text-zinc-500 text-sm">—</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={e => setDateRange(filters.dateFrom, e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Shop selector */}
      <select
        value={filters.shop}
        onChange={e => setShop(e.target.value as Shop)}
        className="px-3 py-1.5 text-sm rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {SHOPS.map(s => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>

      {/* Compare selector */}
      <select
        value={filters.compare}
        onChange={e => setCompare(e.target.value as CompareMode)}
        className="px-3 py-1.5 text-sm rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {COMPARE_OPTIONS.map(c => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
    </header>
  );
}
