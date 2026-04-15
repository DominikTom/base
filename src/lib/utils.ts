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

export const SHOP_COLORS: Record<string, string> = {
  'mybed.pl': '#3b82f6',
  'mybed.de': '#f59e0b',
  'mittohome.pl': '#10b981',
  'showroom': '#8b5cf6',
  'amazon.de': '#f97316',
  'allegro.pl': '#ef4444',
  'kaufland.de': '#06b6d4',
};

export const CATEGORY_COLORS: Record<string, string> = {
  'łóżko': '#3b82f6',
  'materac': '#10b981',
  'kołdra': '#f59e0b',
  'poduszka': '#8b5cf6',
  'sofa': '#ef4444',
  'fotel': '#f97316',
  'pufa': '#06b6d4',
  'meble': '#84cc16',
  'koc': '#ec4899',
  'dekoracje': '#14b8a6',
  'inne': '#6b7280',
};
