'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

// Chrome wykresów (siatka, osie, tooltip) reagujący na motyw light/dark.
// Recharts ustawia kolory jako atrybuty SVG, które nie czytają zmiennych
// CSS — stąd wartości z palety design systemu zebrane tutaj, w jednym
// miejscu (analogicznie do wyjątku dla szablonów e-mail).
const LIGHT = {
  grid: '#E5E7EB',
  axis: '#D1D5DB',
  tick: '#4B5563',
  tickFaint: '#9CA3AF',
  tooltip: {
    backgroundColor: '#FFFFFF',
    border: '1px solid #E5E7EB',
    borderRadius: '10px',
    fontSize: '12px',
    color: '#111827',
    boxShadow: '0 10px 40px -12px rgba(15, 23, 42, 0.22)',
  } as CSSProperties,
  tooltipLabel: { color: '#4B5563' } as CSSProperties,
};

const DARK: typeof LIGHT = {
  grid: '#2E2E32',
  axis: '#3F3F46',
  tick: '#98989E',
  tickFaint: '#6D6D73',
  tooltip: {
    backgroundColor: '#1C1C1E',
    border: '1px solid #2E2E32',
    borderRadius: '10px',
    fontSize: '12px',
    color: '#E8E8EA',
    boxShadow: '0 10px 40px -12px rgba(0, 0, 0, 0.5)',
  },
  tooltipLabel: { color: '#98989E' },
};

export function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains('dark'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export function useChartTheme() {
  return useIsDark() ? DARK : LIGHT;
}

// Kolory serii danych — odcienie 500 z rodzin statusowych palety,
// wspólne dla obu motywów.
export const CHART_PRIMARY = '#4F46E5';
export const CHART_ACCENT = '#06B6D4';
export const CHART_SERIES = [
  '#6366F1', '#06B6D4', '#10B981', '#F59E0B', '#8B5CF6',
  '#F97316', '#0EA5E9', '#14B8A6', '#EF4444', '#3B82F6',
];
