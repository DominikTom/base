'use client';

import { useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/ui/data-table';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';
import type { AttributionWindow } from '@/lib/marketing-constants';
import { ImageIcon, Video } from 'lucide-react';
import { AttributionSelect, ExportCsvButton } from './controls';
import { CreativeThumb } from './creative-thumb';
import { AdPreviewModal } from './ad-preview-modal';
import { attributed, type AdRow, type AdsPayload } from './types';

type SortKey = 'roas' | 'spend' | 'purchases';

interface CreativesTabProps {
  data: AdsPayload;
  dateFrom: string;
  dateTo: string;
  shop: string;
  attribution: AttributionWindow;
  onAttributionChange: (w: AttributionWindow) => void;
}

// Zakładka Kreacje: Top 10 statycznych i Top 10 wideo (jak w narzędziu
// agencji) + pełna tabela reklam. Klik w kreację otwiera modal z podglądem
// na żywo (iframe Meta → wideo HD → obraz).
export function CreativesTab({
  data, dateFrom, dateTo, shop, attribution, onAttributionChange,
}: CreativesTabProps) {
  const [sortKey, setSortKey] = useState<SortKey>('roas');
  const [selected, setSelected] = useState<AdRow | null>(null);

  const { topStatic, topVideo } = useMemo(() => {
    const sorter = (a: AdRow, b: AdRow) => {
      if (sortKey === 'spend') return b.spend - a.spend;
      const aa = attributed(a, attribution);
      const bb = attributed(b, attribution);
      return sortKey === 'roas' ? bb.roas - aa.roas : bb.purchases - aa.purchases;
    };
    const withSpend = data.ads.filter(a => a.spend > 0);
    return {
      topStatic: withSpend.filter(a => a.creative?.format !== 'video').sort(sorter).slice(0, 10),
      topVideo: withSpend.filter(a => a.creative?.format === 'video').sort(sorter).slice(0, 10),
    };
  }, [data.ads, sortKey, attribution]);

  const tableColumns: Column<AdRow>[] = [
    { key: 'adName', header: 'Reklama', accessor: r => r.adName, className: 'max-w-[260px] truncate' },
    { key: 'format', header: 'Format', accessor: r => r.creative?.format || '—' },
    { key: 'shop', header: 'Sklep', accessor: r => r.shop },
    { key: 'campaignName', header: 'Kampania', accessor: r => r.campaignName, className: 'max-w-[200px] truncate' },
    { key: 'spend', header: 'Wydatki', accessor: r => r.spend, align: 'right', format: v => formatCurrency(v as number) },
    { key: 'ctr', header: 'CTR', accessor: r => r.ctr, align: 'right', format: v => `${(v as number).toFixed(2)}%` },
    { key: 'cpm', header: 'CPM', accessor: r => r.cpm, align: 'right', format: v => `${(v as number).toFixed(2)} zł` },
    {
      key: 'hookRate', header: 'Hook rate', accessor: r => r.hookRate, align: 'right',
      format: v => (v as number) > 0 ? `${(v as number).toFixed(1)}%` : '—',
    },
    { key: 'leads', header: 'Leady', accessor: r => r.leads, align: 'right' },
    { key: 'purchases', header: 'Zakupy', accessor: r => attributed(r, attribution).purchases, align: 'right' },
    {
      key: 'roas', header: 'ROAS', accessor: r => attributed(r, attribution).roas, align: 'right',
      format: v => `${(v as number).toFixed(2)}×`,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-muted">
          Sortuj Top 10:
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="bg-bg text-fg text-xs rounded-lg px-2 py-1.5 border border-line"
          >
            <option value="roas">ROAS</option>
            <option value="spend">Wydatki</option>
            <option value="purchases">Zakupy</option>
          </select>
        </label>
        <div className="flex items-center gap-3">
          <AttributionSelect value={attribution} onChange={onAttributionChange} />
          <ExportCsvButton scope="ads" dateFrom={dateFrom} dateTo={dateTo} shop={shop} />
        </div>
      </div>

      {/* Top 10 static / video */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <TopList
          title="Top 10 — Statyczne"
          icon={<ImageIcon size={15} className="text-muted" />}
          ads={topStatic}
          attribution={attribution}
          onSelect={setSelected}
        />
        <TopList
          title="Top 10 — Wideo"
          icon={<Video size={15} className="text-muted" />}
          ads={topVideo}
          attribution={attribution}
          onSelect={setSelected}
        />
      </div>

      {/* Pełna tabela reklam */}
      <div className="rounded-card border border-line bg-surface p-4 shadow-card">
        <h3 className="text-sm font-medium text-fg mb-3">
          Wszystkie reklamy <span className="text-muted font-normal">· klik = podgląd kreacji</span>
        </h3>
        <DataTable data={data.ads} columns={tableColumns} pageSize={15} onRowClick={setSelected} />
      </div>

      {selected && (
        <AdPreviewModal
          key={selected.adId}
          ad={selected}
          dateFrom={dateFrom}
          dateTo={dateTo}
          attribution={attribution}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function TopList({
  title, icon, ads, attribution, onSelect,
}: {
  title: string;
  icon: React.ReactNode;
  ads: AdRow[];
  attribution: AttributionWindow;
  onSelect: (ad: AdRow) => void;
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-medium text-fg">{title}</h3>
        <span className="text-xs text-muted">{ads.length} reklam</span>
      </div>
      {ads.length === 0 ? (
        <p className="text-xs text-muted py-6 text-center">Brak reklam w tym zakresie</p>
      ) : (
        <ul className="space-y-1">
          {ads.map((ad, i) => {
            const att = attributed(ad, attribution);
            return (
              <li key={ad.adId}>
                <button
                  onClick={() => onSelect(ad)}
                  className="w-full flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-bg transition-colors text-left"
                >
                  <span className="relative">
                    <CreativeThumb ad={ad} size={44} />
                    <span className="absolute -top-1 -left-1 w-4 h-4 rounded bg-accent-bg text-[10px] text-accent-fg flex items-center justify-center font-semibold">
                      {i + 1}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-fg truncate">{ad.adName}</span>
                    <span className="block text-[11px] text-muted truncate">
                      {ad.creative?.format || '—'} · {ad.shop}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-[10px] uppercase text-muted">Wydatki</span>
                    <span className="block text-xs text-fg-soft">{formatNumber(ad.spend, 2)} zł</span>
                  </span>
                  <span className="text-right shrink-0 w-20">
                    <span className="block text-[10px] uppercase text-muted">ROAS</span>
                    <span className={cn('block text-xs font-semibold', att.roas >= 1 ? 'text-emerald-600' : 'text-danger')}>
                      {att.roas.toFixed(2)}×
                    </span>
                  </span>
                  <span className="text-right shrink-0 w-14">
                    <span className="block text-[10px] uppercase text-muted">Zakupy</span>
                    <span className="block text-xs text-fg-soft">{att.purchases}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
