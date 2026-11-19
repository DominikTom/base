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
  onCreativeSaved?: (creativeId: string, fields: { manualTags: string[]; manualNotes: string | null }) => void;
}

// Zakładka Kreacje: Top 10 statycznych i Top 10 wideo (jak w narzędziu
// agencji) + pełna tabela reklam. Klik w kreację otwiera modal z podglądem
// na żywo (iframe Meta → wideo HD → obraz).
export function CreativesTab({
  data, dateFrom, dateTo, shop, attribution, onAttributionChange, onCreativeSaved,
}: CreativesTabProps) {
  const [sortKey, setSortKey] = useState<SortKey>('roas');
  const [tagFilter, setTagFilter] = useState('');
  const [selected, setSelected] = useState<AdRow | null>(null);

  // Tag pasuje, gdy nosi go kreacja (auto/AI/manualny) LUB kampania nadrzędna —
  // Kamila taguje kampanię "test kreacji" i widzi tu wszystkie jej reklamy.
  const campaignTags = useMemo(
    () => new Map(data.campaigns.map(c => [c.campaignId, c.tags])),
    [data.campaigns]
  );
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const a of data.ads) for (const t of a.creative?.tags || []) set.add(t);
    for (const c of data.campaigns) for (const t of c.tags) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pl'));
  }, [data.ads, data.campaigns]);

  const filteredAds = useMemo(() => {
    if (!tagFilter) return data.ads;
    return data.ads.filter(a =>
      (a.creative?.tags || []).includes(tagFilter) ||
      (campaignTags.get(a.campaignId) || []).includes(tagFilter)
    );
  }, [data.ads, tagFilter, campaignTags]);

  const { topStatic, topVideo } = useMemo(() => {
    const sorter = (a: AdRow, b: AdRow) => {
      if (sortKey === 'spend') return b.spend - a.spend;
      const aa = attributed(a, attribution);
      const bb = attributed(b, attribution);
      return sortKey === 'roas' ? bb.roas - aa.roas : bb.purchases - aa.purchases;
    };
    const withSpend = filteredAds.filter(a => a.spend > 0);
    return {
      topStatic: withSpend.filter(a => a.creative?.format !== 'video').sort(sorter).slice(0, 10),
      topVideo: withSpend.filter(a => a.creative?.format === 'video').sort(sorter).slice(0, 10),
    };
  }, [filteredAds, sortKey, attribution]);

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
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          Sortuj Top 10:
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="rounded-xl border border-line bg-surface px-2 py-1.5 text-xs text-ink-soft focus:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/10"
          >
            <option value="roas">ROAS</option>
            <option value="spend">Wydatki</option>
            <option value="purchases">Zakupy</option>
          </select>
        </label>
        <div className="flex items-center gap-3 flex-wrap">
          {allTags.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              Tag:
              <select
                value={tagFilter}
                onChange={e => setTagFilter(e.target.value)}
                className="rounded-xl border border-line bg-surface px-2 py-1.5 text-xs text-ink-soft focus:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/10 max-w-[160px]"
              >
                <option value="">wszystkie</option>
                {allTags.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          )}
          <AttributionSelect value={attribution} onChange={onAttributionChange} />
          <ExportCsvButton scope="ads" dateFrom={dateFrom} dateTo={dateTo} shop={shop} />
        </div>
      </div>

      {/* Top 10 static / video */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <TopList
          title="Top 10 — Statyczne"
          icon={<ImageIcon size={15} className="text-ink-muted" />}
          ads={topStatic}
          attribution={attribution}
          onSelect={setSelected}
        />
        <TopList
          title="Top 10 — Wideo"
          icon={<Video size={15} className="text-ink-muted" />}
          ads={topVideo}
          attribution={attribution}
          onSelect={setSelected}
        />
      </div>

      {/* Pełna tabela reklam */}
      <div className="card p-4">
        <h3 className="section-title mb-3">
          Wszystkie reklamy <span className="text-ink-muted font-normal">· klik = podgląd kreacji{tagFilter ? ` · filtr: ${tagFilter}` : ''}</span>
        </h3>
        <DataTable data={filteredAds} columns={tableColumns} pageSize={15} onRowClick={setSelected} />
      </div>

      {selected && (
        <AdPreviewModal
          key={selected.adId}
          ad={selected}
          dateFrom={dateFrom}
          dateTo={dateTo}
          attribution={attribution}
          onClose={() => setSelected(null)}
          onCreativeSaved={onCreativeSaved}
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
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="section-title">{title}</h3>
        <span className="text-xs text-ink-faint">{ads.length} reklam</span>
      </div>
      {ads.length === 0 ? (
        <p className="text-xs text-ink-faint py-6 text-center">Brak reklam w tym zakresie</p>
      ) : (
        <ul className="space-y-1">
          {ads.map((ad, i) => {
            const att = attributed(ad, attribution);
            return (
              <li key={ad.adId}>
                <button
                  onClick={() => onSelect(ad)}
                  className="w-full flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2 transition-colors text-left"
                >
                  <span className="relative">
                    <CreativeThumb ad={ad} size={44} />
                    <span className="absolute -top-1 -left-1 w-4 h-4 rounded bg-primary text-[10px] text-white flex items-center justify-center font-semibold">
                      {i + 1}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink truncate">{ad.adName}</span>
                    <span className="block text-[11px] text-ink-faint truncate">
                      {ad.creative?.format || '—'} · {ad.shop}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-[10px] font-medium text-ink-muted">Wydatki</span>
                    <span className="block font-mono text-xs text-ink-soft">{formatNumber(ad.spend, 2)} zł</span>
                  </span>
                  <span className="text-right shrink-0 w-20">
                    <span className="block text-[10px] font-medium text-ink-muted">ROAS</span>
                    <span className={cn('block font-mono text-xs font-semibold', att.roas >= 1 ? 'text-emerald-600' : 'text-red-600')}>
                      {att.roas.toFixed(2)}×
                    </span>
                  </span>
                  <span className="text-right shrink-0 w-14">
                    <span className="block text-[10px] font-medium text-ink-muted">Zakupy</span>
                    <span className="block font-mono text-xs text-ink-soft">{att.purchases}</span>
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
