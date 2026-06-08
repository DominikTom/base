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
export const SHOP_COLORS: Record<string, string> = {
  'mybed.pl':     '#7E22CE',  // primary-700 — główny sklep
  'mybed.de':     '#A855F7',  // primary-500
  'mittohome.pl': '#C084FC',  // primary-400
  'showroom':    '#581C87',  // primary-900 — głęboki
  'amazon.de':   '#9333EA',  // primary-600
  'allegro.pl':  '#D8B4FE',  // primary-300
  'kaufland.de': '#6B21A8',  // primary-800
};

export const CATEGORY_COLORS: Record<string, string> = {
  'łóżko':      '#7E22CE',  // primary-700 — flagship
  'materac':    '#A855F7',  // primary-500
  'kołdra':     '#C084FC',  // primary-400
  'poduszka':   '#D8B4FE',  // primary-300
  'sofa':       '#9333EA',  // primary-600
  'fotel':      '#6B21A8',  // primary-800
  'pufa':       '#581C87',  // primary-900
  'meble':      '#E9D5FF',  // primary-200
  'koc':        '#F3E8FF',  // primary-100
  'dekoracje':  '#7C3AED',  // accent fiolet
  'inne':       '#0F1310',  // czarny akcent dla „inne"
};
