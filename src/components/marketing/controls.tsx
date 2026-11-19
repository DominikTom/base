'use client';

import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ATTRIBUTION_WINDOWS, type AttributionWindow } from '@/lib/marketing-constants';

// Selektor okna atrybucji — przełącza kolumny Zakupy/Przychód/ROAS
// między oknem domyślnym konta a 1d_click / 7d_click / 1d_view.
export function AttributionSelect({
  value, onChange,
}: {
  value: AttributionWindow;
  onChange: (w: AttributionWindow) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-ink-muted">
      Atrybucja:
      <select
        value={value}
        onChange={e => onChange(e.target.value as AttributionWindow)}
        className="rounded-xl border border-line bg-surface px-2 py-1.5 text-xs text-ink-soft focus:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/10"
      >
        {ATTRIBUTION_WINDOWS.map(w => (
          <option key={w.value} value={w.value}>{w.label}</option>
        ))}
      </select>
    </label>
  );
}

// Eksport CSV z zachowaniem bieżącego zakresu dat i filtra sklepu.
// Zwykły <a> — przeglądarka pobiera plik z nazwą z Content-Disposition.
export function ExportCsvButton({
  scope, dateFrom, dateTo, shop,
}: {
  scope: 'campaigns' | 'adsets' | 'ads' | 'daily';
  dateFrom: string;
  dateTo: string;
  shop: string;
}) {
  const href = `/api/dashboard/marketing/export?scope=${scope}&date_from=${dateFrom}&date_to=${dateTo}&shop=${encodeURIComponent(shop)}`;
  return (
    <a
      href={href}
      className="btn-secondary gap-1.5 px-3 py-1.5 text-xs"
    >
      <Download size={13} />
      Eksport CSV
    </a>
  );
}

// Delta okres-do-okresu w stylu narzędzia agencji: ▲ zielona / ▼ czerwona.
// invert=true dla metryk kosztowych (CPM, CPL), gdzie spadek jest dobry.
export function DeltaBadge({
  value, invert = false, suffix = '%',
}: {
  value: number | null | undefined;
  invert?: boolean;
  suffix?: string;
}) {
  if (value === null || value === undefined) {
    return <span className="text-[11px] text-ink-faint">—</span>;
  }
  const good = invert ? value < 0 : value >= 0;
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded border',
      good ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'
    )}>
      {value >= 0 ? '▲' : '▼'} {Math.abs(value).toFixed(1)}{suffix}
    </span>
  );
}
