'use client';

import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { format, subDays } from 'date-fns';
import type { Shop, CompareMode, DashboardFilters } from '@/types/database';

export interface CrossFilter {
  field: string;   // e.g. "product_name", "fabric_collection", "supplier"
  value: string;   // e.g. "Łóżko Livv", "Storm", "Comfy"
  label: string;   // display label e.g. "Model: Łóżko Livv"
}

interface DashboardContextType {
  filters: DashboardFilters;
  crossFilters: CrossFilter[];
  setDateRange: (from: string, to: string) => void;
  setShop: (shop: Shop) => void;
  setCompare: (compare: CompareMode) => void;
  applyPreset: (preset: string) => void;
  addCrossFilter: (filter: CrossFilter) => void;
  removeCrossFilter: (field: string) => void;
  clearCrossFilters: () => void;
}

const DashboardContext = createContext<DashboardContextType | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<DashboardFilters>({
    dateFrom: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    dateTo: format(new Date(), 'yyyy-MM-dd'),
    shop: 'all',
    compare: 'none',
  });
  const [crossFilters, setCrossFilters] = useState<CrossFilter[]>([]);

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
      case '7d': setFilters(f => ({ ...f, dateFrom: fmt(subDays(today, 7)), dateTo: fmt(today) })); break;
      case '30d': setFilters(f => ({ ...f, dateFrom: fmt(subDays(today, 30)), dateTo: fmt(today) })); break;
      case '90d': setFilters(f => ({ ...f, dateFrom: fmt(subDays(today, 90)), dateTo: fmt(today) })); break;
    }
  }, []);

  const addCrossFilter = useCallback((filter: CrossFilter) => {
    setCrossFilters(prev => {
      // Replace existing filter for the same field, or add new
      const without = prev.filter(f => f.field !== filter.field);
      return [...without, filter];
    });
  }, []);

  const removeCrossFilter = useCallback((field: string) => {
    setCrossFilters(prev => prev.filter(f => f.field !== field));
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
