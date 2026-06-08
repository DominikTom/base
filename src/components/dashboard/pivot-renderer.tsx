'use client';

import { useMemo, useState } from 'react';
import { ArrowUp, ArrowDown, Download } from 'lucide-react';
import { formatCurrency, formatNumber } from '@/lib/utils';
import type { PivotFormat } from '@/lib/explorer-whitelist';

interface PivotColumn {
  key: string;
  label: string;
  format: PivotFormat;
}

interface PivotRow {
  dim_values: string[];
  metrics: Record<string, number>;
}

export interface PivotResponse {
  row_dims: string[];
  columns: PivotColumn[];
  rows: PivotRow[];
  totals: Record<string, number>;
}

const DIM_LABELS: Record<string, string> = {
  date: 'Data',
  source_shop: 'Sklep',
  source_platform: 'Platforma',
  campaign: 'Kampania',
  service_type: 'Typ usługi',
  supplier: 'Dostawca',
  status: 'Status',
  delivery_city: 'Miasto',
  coupon_code: 'Kupon',
};

function formatValue(v: number, fmt: PivotFormat): string {
  if (!Number.isFinite(v)) return '—';
  switch (fmt) {
    case 'pln': return formatCurrency(Math.round(v));
    case 'pct': return `${v.toFixed(2)}%`;
    case 'ratio': return `${v.toFixed(2)}x`;
    case 'number':
    default:
      return formatNumber(Math.round(v));
  }
}

function toCsv(rowDims: string[], columns: PivotColumn[], rows: PivotRow[], totals: Record<string, number>): string {
  const sep = ';';
  const lines: string[] = [];
  const header = [...rowDims.map(d => DIM_LABELS[d] || d), ...columns.map(c => c.label)];
  lines.push(header.join(sep));
  for (const r of rows) {
    const line = [...r.dim_values, ...columns.map(c => String(r.metrics[c.key] ?? 0))];
    lines.push(line.join(sep));
  }
  const totalLine = ['TOTAL', ...new Array(rowDims.length - 1).fill(''), ...columns.map(c => String(totals[c.label] ?? 0))];
  lines.push(totalLine.join(sep));
  return lines.join('\n');
}

export function PivotRenderer({ data }: { data: PivotResponse }) {
  const { row_dims = [], columns = [], rows = [], totals = {} } = data || ({} as PivotResponse);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sortedRows = useMemo(() => {
    if (!sortBy) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sortBy.startsWith('__dim_')) {
        const idx = parseInt(sortBy.replace('__dim_', ''), 10);
        const av = a.dim_values[idx] || '';
        const bv = b.dim_values[idx] || '';
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const av = Number(a.metrics[sortBy]) || 0;
      const bv = Number(b.metrics[sortBy]) || 0;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return copy;
  }, [rows, sortBy, sortDir]);

  function clickSort(key: string) {
    if (sortBy === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir('desc'); }
  }

  function downloadCsv() {
    const csv = toCsv(row_dims, columns, sortedRows, totals);
    // BOM żeby Excel poprawnie wykrył UTF-8 (polskie znaki)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pivot-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (rows.length === 0) {
    return <div className="text-center text-muted py-12 text-sm">Brak danych dla wybranych filtrów.</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button onClick={downloadCsv} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-bg hover:bg-line text-fg-soft border border-line">
          <Download size={12} /> CSV
        </button>
      </div>
      <div className="overflow-auto rounded border border-line">
        <table className="w-full text-xs">
          <thead className="bg-surface sticky top-0">
            <tr>
              {row_dims.map((d, idx) => (
                <th
                  key={d}
                  onClick={() => clickSort(`__dim_${idx}`)}
                  className="px-3 py-2 text-left font-medium text-fg-soft cursor-pointer hover:text-fg select-none"
                >
                  <span className="flex items-center gap-1">
                    {DIM_LABELS[d] || d}
                    <SortIcon active={sortBy === `__dim_${idx}`} dir={sortDir} />
                  </span>
                </th>
              ))}
              {columns.map(c => (
                <th
                  key={c.key}
                  onClick={() => clickSort(c.key)}
                  className="px-3 py-2 text-right font-medium text-fg-soft cursor-pointer hover:text-fg select-none"
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    <SortIcon active={sortBy === c.key} dir={sortDir} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r, i) => (
              <tr key={i} className="border-t border-line hover:bg-bg">
                {r.dim_values.map((v, j) => (
                  <td key={j} className="px-3 py-1.5 text-fg-soft">{v || '—'}</td>
                ))}
                {columns.map(c => (
                  <td key={c.key} className="px-3 py-1.5 text-right text-fg tabular-nums">
                    {formatValue(r.metrics[c.key] || 0, c.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-surface/95 border-t border-line">
            <tr>
              <td colSpan={row_dims.length} className="px-3 py-2 font-semibold text-fg">TOTAL</td>
              {columns.map(c => (
                <td key={c.key} className="px-3 py-2 text-right font-semibold text-fg tabular-nums">
                  {formatValue(totals[c.label] ?? 0, c.format)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return null;
  return dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />;
}
