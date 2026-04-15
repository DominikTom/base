'use client';

import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { format, subDays } from 'date-fns';
import type { Shop, CompareMode, DashboardFilters } from '@/types/database';

interface DashboardContextType {
  filters: DashboardFilters;
  setDateRange: (from: string, to: string) => void;
  setShop: (shop: Shop) => void;
  setCompare: (compare: CompareMode) => void;
  applyPreset: (preset: string) => void;
}

const DashboardContext = createContext<DashboardContextType | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<DashboardFilters>({
    dateFrom: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    dateTo: format(new Date(), 'yyyy-MM-dd'),
    shop: 'all',
    compare: 'none',
  });

  const setDateRange = useCallback((from: string, to: string) => {
    setFilters(f => ({ ...f, dateFrom: from, dateTo: to }));
  }, []);

  const setShop = useCallback((shop: Shop) => {
    setFilters(f => ({ ...f, shop }));
  }, []);

  const setCompare = useCallback((compare: CompareMode) => {
    setFilters(f => ({ ...f, compare }));
  }, []);

  const applyPreset = useCallback((preset: string) => {
    const today = new Date();
    const fmt = (d: Date) => format(d, 'yyyy-MM-dd');
    switch (preset) {
      case '7d':
        setFilters(f => ({ ...f, dateFrom: fmt(subDays(today, 7)), dateTo: fmt(today) }));
        break;
      case '30d':
        setFilters(f => ({ ...f, dateFrom: fmt(subDays(today, 30)), dateTo: fmt(today) }));
        break;
      case '90d':
        setFilters(f => ({ ...f, dateFrom: fmt(subDays(today, 90)), dateTo: fmt(today) }));
        break;
      default:
        break;
    }
  }, []);

  return (
    <DashboardContext.Provider value={{ filters, setDateRange, setShop, setCompare, applyPreset }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
  return ctx;
}
