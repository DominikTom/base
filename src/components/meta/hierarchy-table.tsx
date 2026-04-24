'use client';

import { DataTable, type Column } from '@/components/ui/data-table';
import { formatCurrency, formatNumber } from '@/lib/utils';

export interface HierarchyRow {
  id: string;
  name: string;
  parent_id?: string | null;
  parent_name?: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  roas: number;
  ctr: number;
  cpa: number;
  hook_rate: number;
  ads_count: number;
  adsets_count: number;
  creatives_count: number;
}

export function HierarchyTable({
  rows,
  variant,
  onRowClick,
}: {
  rows: HierarchyRow[];
  variant: 'campaign' | 'adset';
  onRowClick: (row: HierarchyRow) => void;
}) {
  const columns: Column<HierarchyRow>[] = [
    {
      key: 'name',
      header: variant === 'campaign' ? 'Kampania' : 'Zestaw reklam',
      accessor: r => r.name,
      className: 'max-w-[280px] truncate',
    },
    ...(variant === 'adset' ? [{
      key: 'parent_name',
      header: 'Kampania',
      accessor: (r: HierarchyRow) => r.parent_name || '—',
      className: 'max-w-[220px] truncate text-zinc-400',
    }] : []),
    {
      key: 'spend',
      header: 'Spend',
      accessor: r => r.spend,
      align: 'right',
      format: v => formatCurrency(v as number),
    },
    {
      key: 'roas',
      header: 'ROAS',
      accessor: r => r.roas,
      align: 'right',
      format: v => `${(v as number).toFixed(2)}x`,
    },
    {
      key: 'conversions',
      header: 'Konw.',
      accessor: r => r.conversions,
      align: 'right',
      format: v => formatNumber(v as number),
    },
    {
      key: 'cpa',
      header: 'CPA',
      accessor: r => r.cpa,
      align: 'right',
      format: v => (v as number) > 0 ? `${(v as number).toFixed(2)} zł` : '—',
    },
    {
      key: 'ctr',
      header: 'CTR',
      accessor: r => r.ctr,
      align: 'right',
      format: v => `${(v as number).toFixed(2)}%`,
    },
    {
      key: 'hook_rate',
      header: 'Hook',
      accessor: r => r.hook_rate,
      align: 'right',
      format: v => (v as number) > 0 ? `${(v as number).toFixed(1)}%` : '—',
    },
    ...(variant === 'campaign' ? [{
      key: 'adsets_count',
      header: 'Zestawy',
      accessor: (r: HierarchyRow) => r.adsets_count,
      align: 'right' as const,
      format: (v: string | number) => formatNumber(v as number),
    }] : []),
    {
      key: 'creatives_count',
      header: 'Kreacje',
      accessor: r => r.creatives_count,
      align: 'right',
      format: v => formatNumber(v as number),
    },
  ];

  return (
    <DataTable
      data={rows}
      columns={columns}
      pageSize={25}
      onRowClick={onRowClick}
    />
  );
}
