'use client';

import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import type { CompareMode, DashboardFilters } from '@/types/database';

export interface CrossFilter {
  field: string;   // e.g. "product_name", "fabric_collection", "supplier"
  value: string;   // e.g. "Łóżko Livv", "Storm", "Comfy"
  label: string;   // display label e.g. "Model: Łóżko Livv"
}

interface DashboardContextType {
  filters: DashboardFilters;
  crossFilters: CrossFilter[];
  setDateRange: (from: string, to: string) => void;
  setShop: (shop: string) => void;
  setCompare: (compare: CompareMode) => void;
  applyPreset: (preset: string) => void;
  addCrossFilter: (filter: CrossFilter) => void;
  removeCrossFilter: (field: string, value?: string) => void;
  clearCrossFilters: () => void;
}

const DashboardContext = createContext<DashboardContextType | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<DashboardFilters>({
    // Default: ostatnie 30 pełnych dni kończących się wczoraj (taki sam zakres
    // co preset "30 dni" — dzień bieżący jest niepełny, pomijamy).
    dateFrom: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    dateTo: format(subDays(new Date(), 1), 'yyyy-MM-dd'),
    shop: 'all',
    compare: 'none',
  });
  const [crossFilters, setCrossFilters] = useState<CrossFilter[]>([]);

  const setDateRange = useCallback((from: string, to: string) => {
    setFilters(f => ({ ...f, dateFrom: from, dateTo: to }));
  }, []);

  const setShop = useCallback((shop: string) => {
    setFilters(f => ({ ...f, shop }));
  }, []);

  const setCompare = useCallback((compare: CompareMode) => {
    setFilters(f => ({ ...f, compare }));
  }, []);

  const applyPreset = useCallback((preset: string) => {
    const today = new Date();
    const fmt = (d: Date) => format(d, 'yyyy-MM-dd');
    const set = (from: Date, to: Date) => setFilters(f => ({ ...f, dateFrom: fmt(from), dateTo: fmt(to) }));
    // Presety N dni kończą się WCZORAJ — dziś jest dniem niepełnym (CSV
    // ciągnięty rano, sprzedaż jeszcze trwa), więc nie zaburza średnich.
    const yesterday = subDays(today, 1);
    switch (preset) {
      case 'today': set(today, today); break;
      case 'yesterday': set(yesterday, yesterday); break;
      case '7d': set(subDays(today, 7), yesterday); break;
      case '30d': set(subDays(today, 30), yesterday); break;
      case '90d': set(subDays(today, 90), yesterday); break;
      case 'this_month': set(startOfMonth(today), today); break;
      case 'prev_month': { const prev = subMonths(today, 1); set(startOfMonth(prev), endOfMonth(prev)); break; }
    }
  }, []);

  // Looker-style toggle: klik na tę samą (field, value) usuwa wpis; klik na nową
  // wartość dorzuca się do listy (multi-select). Klik na inne pole stackuje (AND
  // między polami, OR/IN wewnątrz pola — patrz applyCross w widgets/route.ts).
  // Porównanie case-insensitive, bo wartości w rankingach mogą być normalizowane
  // (np. coupon_code uppercase) i muszą porównywać się z oryginałem w bazie.
  const addCrossFilter = useCallback((filter: CrossFilter) => {
    setCrossFilters(prev => {
      const idx = prev.findIndex(f =>
        f.field === filter.field &&
        f.value.toLowerCase() === filter.value.toLowerCase(),
      );
      if (idx >= 0) return prev.filter((_, i) => i !== idx);
      return [...prev, filter];
    });
  }, []);

  const removeCrossFilter = useCallback((field: string, value?: string) => {
    setCrossFilters(prev => prev.filter(f => {
      if (f.field !== field) return true;
      if (value === undefined) return false; // bez value = usuń wszystkie tego pola
      return f.value.toLowerCase() !== value.toLowerCase();
    }));
  }, []);

  const clearCrossFilters = useCallback(() => {
    setCrossFilters([]);
  }, []);

  return (
    <DashboardContext.Provider value={{
      filters, crossFilters,
      setDateRange, setShop, setCompare, applyPreset,
      addCrossFilter, removeCrossFilter, clearCrossFilters,
    }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
  return ctx;
}
