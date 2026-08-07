import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, subDays, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfWeek, endOfWeek } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, currency: string = 'PLN'): string {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number, decimals: number = 0): string {
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPercent(value: number, decimals: number = 1): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`;
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}

export function getDateRange(preset: string): { from: string; to: string } {
  const today = new Date();
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd');

  switch (preset) {
    case '7d':
      return { from: fmt(subDays(today, 7)), to: fmt(today) };
    case '30d':
      return { from: fmt(subDays(today, 30)), to: fmt(today) };
    case '90d':
      return { from: fmt(subDays(today, 90)), to: fmt(today) };
    case 'mtd':
      return { from: fmt(startOfMonth(today)), to: fmt(today) };
    case 'qtd':
      return { from: fmt(startOfQuarter(today)), to: fmt(today) };
    case 'last_month': {
      const lastMonth = subDays(startOfMonth(today), 1);
      return { from: fmt(startOfMonth(lastMonth)), to: fmt(endOfMonth(lastMonth)) };
    }
    case 'last_week': {
      const lastWeek = subDays(startOfWeek(today, { weekStartsOn: 1 }), 1);
      return { from: fmt(startOfWeek(lastWeek, { weekStartsOn: 1 })), to: fmt(endOfWeek(lastWeek, { weekStartsOn: 1 })) };
    }
    default:
      return { from: fmt(subDays(today, 30)), to: fmt(today) };
  }
}

// Palety serii — odcienie primary (fiolet). Sklepy/kategorie zachowują
// własne kolory (ich identyfikacja), ale teraz w spójnej rodzinie.
// Kolory serii danych na wykresach — odcienie 500 z rodzin statusowych
// design systemu (wspólne dla light/dark). Recharts nie czyta zmiennych
// CSS w atrybutach SVG, stąd wartości zebrane tutaj, w jednym miejscu.
export const SHOP_COLORS: Record<string, string> = {
  'mybed.pl':     '#4F46E5',  // indygo (primary) — główny sklep
  'mybed.de':     '#06B6D4',  // cyjan (accent)
  'mittohome.pl': '#8B5CF6',  // violet
  'showroom':     '#14B8A6',  // teal
  'amazon.de':    '#F59E0B',  // amber
  'allegro.pl':   '#F97316',  // orange
  'kaufland.de':  '#0EA5E9',  // sky
};

export const CATEGORY_COLORS: Record<string, string> = {
  'łóżko':      '#4F46E5',  // indygo (primary)
  'materac':    '#06B6D4',  // cyjan (accent)
  'kołdra':     '#8B5CF6',  // violet
  'poduszka':   '#0EA5E9',  // sky
  'sofa':       '#14B8A6',  // teal
  'fotel':      '#F59E0B',  // amber
  'pufa':       '#F97316',  // orange
  'meble':      '#10B981',  // emerald
  'koc':        '#3B82F6',  // blue
  'dekoracje':  '#EF4444',  // red
  'inne':       '#6B7280',  // gray
};
