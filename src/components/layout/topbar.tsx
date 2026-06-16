'use client';

import { useDashboard } from '@/lib/dashboard-context';
import { shopFilterToList } from '@/lib/shop-filter';
import { Check } from 'lucide-react';

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

      {/* Shop multi-select (pillowe checkboxy). Klik = toggle. */}
      <div className="flex items-center gap-1 bg-surface border border-line rounded-pill p-1 shadow-card">
        <button
          onClick={setAll}
          className={`px-3 py-1 text-xs font-medium rounded-pill transition-colors ${
            allSelected ? 'bg-primary-600 text-white' : 'text-fg-soft hover:text-fg hover:bg-bg'
          }`}
        >
          Wszystkie
        </button>
        {SHOPS.map(s => {
          const active = !allSelected && selected.has(s.value);
          return (
            <button
              key={s.value}
              onClick={() => toggle(s.value)}
              className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-pill transition-colors ${
                active ? 'bg-primary-600 text-white' : 'text-fg-soft hover:text-fg hover:bg-bg'
              }`}
            >
              {active && <Check size={11} />}
              {s.label}
            </button>
          );
        })}
      </div>
    </header>
  );
}
