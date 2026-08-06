'use client';

import { DataTable, type Column } from '@/components/ui/data-table';
import { formatCurrency, formatNumber } from '@/lib/utils';
import type { AttributionWindow } from '@/lib/marketing-constants';
import { AttributionSelect, ExportCsvButton } from './controls';
import { attributed, type AdsetRow } from './types';

interface AdsetsTabProps {
  adsets: AdsetRow[];
  dateFrom: string;
  dateTo: string;
  shop: string;
  attribution: AttributionWindow;
  onAttributionChange: (w: AttributionWindow) => void;
}

// Zakładka Zestawy reklam — te same KPI co kampanie, poziom ad set.
export function AdsetsTab({
  adsets, dateFrom, dateTo, shop, attribution, onAttributionChange,
}: AdsetsTabProps) {
  const columns: Column<AdsetRow>[] = [
    { key: 'adsetName', header: 'Zestaw reklam', accessor: r => r.adsetName, className: 'max-w-[240px] truncate' },
    { key: 'campaignName', header: 'Kampania', accessor: r => r.campaignName, className: 'max-w-[220px] truncate' },
    { key: 'shop', header: 'Sklep', accessor: r => r.shop },
    { key: 'spend', header: 'Wydatki', accessor: r => r.spend, align: 'right', format: v => formatCurrency(v as number) },
    { key: 'impressions', header: 'Wyśw.', accessor: r => r.impressions, align: 'right', format: v => formatNumber(v as number) },
    { key: 'reach', header: 'Zasięg', accessor: r => r.reach, align: 'right', format: v => formatNumber(v as number) },
    { key: 'frequency', header: 'Częst.', accessor: r => r.frequency, align: 'right', format: v => (v as number).toFixed(2) },
    { key: 'cpm', header: 'CPM', accessor: r => r.cpm, align: 'right', format: v => `${(v as number).toFixed(2)} zł` },
    { key: 'ctr', header: 'CTR', accessor: r => r.ctr, align: 'right', format: v => `${(v as number).toFixed(2)}%` },
    { key: 'cpc', header: 'CPC', accessor: r => r.cpc, align: 'right', format: v => `${(v as number).toFixed(2)} zł` },
    { key: 'leads', header: 'Leady', accessor: r => r.leads, align: 'right' },
    {
      key: 'cpl', header: 'CPL', accessor: r => r.cpl, align: 'right',
      format: v => (v as number) > 0 ? `${(v as number).toFixed(2)} zł` : '—',
    },
    { key: 'purchases', header: 'Zakupy', accessor: r => attributed(r, attribution).purchases, align: 'right' },
    {
      key: 'revenue', header: 'Przychód', accessor: r => attributed(r, attribution).revenue, align: 'right',
      format: v => formatCurrency(v as number),
    },
    {
      key: 'roas', header: 'ROAS', accessor: r => attributed(r, attribution).roas, align: 'right',
      format: v => `${(v as number).toFixed(2)}×`,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <AttributionSelect value={attribution} onChange={onAttributionChange} />
        <ExportCsvButton scope="adsets" dateFrom={dateFrom} dateTo={dateTo} shop={shop} />
      </div>
      <DataTable data={adsets} columns={columns} pageSize={15} />
    </div>
  );
}
