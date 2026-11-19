'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Pencil, Download, Search, StickyNote } from 'lucide-react';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { FUNNEL_STAGES, OBJECTIVE_LABELS, type AttributionWindow } from '@/lib/marketing-constants';
import { AttributionSelect } from './controls';
import { CreativeThumb } from './creative-thumb';
import { AdPreviewModal } from './ad-preview-modal';
import { CampaignMetaEditor } from './campaign-meta-editor';
import {
  attributed,
  type AdsPayload, type CampaignRow, type AdsetRow, type AdRow, type Metrics, type CampaignMetaFields,
} from './types';

// Hierarchiczne drzewo: kampania → zestawy reklam → reklamy.
// Chevron rozwija poziom niżej, klik w reklamę otwiera podgląd kreacji,
// ołówek przy kampanii otwiera edytor metadanych (cel / lejek / notatka).
// Nagłówki kolumn mają tooltipy tłumaczące metryki nie-marketerom.

const FUNNEL_BADGE: Record<string, string> = {
  TOFU: 'bg-sky-50 text-sky-700 border border-sky-200',
  MOFU: 'bg-amber-50 text-amber-700 border border-amber-200',
  BOFU: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  Retargeting: 'bg-violet-50 text-violet-700 border border-violet-200',
  Retencja: 'bg-red-50 text-red-700 border border-red-200',
};

const METRIC_HEADERS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'spend', label: 'Wydatki', hint: 'Łączny koszt reklam w wybranym zakresie dat (PLN)' },
  { key: 'reach', label: 'Zasięg', hint: 'Ile unikalnych osób zobaczyło reklamę (suma dziennych zasięgów — przybliżenie)' },
  { key: 'cpm', label: 'CPM', hint: 'Koszt 1000 wyświetleń reklamy' },
  { key: 'ctr', label: 'CTR', hint: 'Procent wyświetleń zakończonych kliknięciem' },
  { key: 'leads', label: 'Leady', hint: 'Liczba pozyskanych kontaktów (np. formularze)' },
  { key: 'cpl', label: 'CPL', hint: 'Koszt pozyskania jednego leada' },
  { key: 'purchases', label: 'Zakupy', hint: 'Liczba zakupów wg wybranego okna atrybucji' },
  { key: 'revenue', label: 'Przychód', hint: 'Wartość zakupów wg wybranego okna atrybucji (PLN)' },
  { key: 'roas', label: 'ROAS', hint: 'Przychód ÷ wydatki — ile zł przychodu daje 1 zł wydany na reklamę' },
];

interface CampaignTreeProps {
  data: AdsPayload;
  dateFrom: string;
  dateTo: string;
  shop: string;
  attribution: AttributionWindow;
  onAttributionChange: (w: AttributionWindow) => void;
  onMetaSaved: (campaignId: string, fields: CampaignMetaFields) => void;
  onCreativeSaved?: (creativeId: string, fields: { manualTags: string[]; manualNotes: string | null }) => void;
  // Prefiltrowanie po nazwie (wejście z Przeglądu przez klik w kampanię) —
  // renderuj z key={initialQuery}, żeby zmiana fokusu zresetowała drzewo
  initialQuery?: string;
}

export function CampaignTree({
  data, dateFrom, dateTo, shop, attribution, onAttributionChange, onMetaSaved, onCreativeSaved, initialQuery,
}: CampaignTreeProps) {
  const [openCampaigns, setOpenCampaigns] = useState<Set<string>>(new Set());
  const [openAdsets, setOpenAdsets] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState(initialQuery || '');
  const [funnelFilter, setFunnelFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [editing, setEditing] = useState<CampaignRow | null>(null);
  const [selectedAd, setSelectedAd] = useState<AdRow | null>(null);

  // Wszystkie tagi kampanii w zakresie — zasilają dropdown filtra
  const allCampaignTags = useMemo(
    () => Array.from(new Set(data.campaigns.flatMap(c => c.tags))).sort((a, b) => a.localeCompare(b, 'pl')),
    [data.campaigns]
  );

  // Filtry lejka i tagu zawężają listę kampanii PRZED wyszukiwarką
  const baseCampaigns = useMemo(
    () => data.campaigns.filter(c =>
      (!funnelFilter || c.funnelStage === funnelFilter) &&
      (!tagFilter || c.tags.includes(tagFilter))
    ),
    [data.campaigns, funnelFilter, tagFilter]
  );

  const { adsetsByCampaign, adsByAdset } = useMemo(() => {
    const byCampaign = new Map<string, AdsetRow[]>();
    for (const s of data.adsets) {
      const list = byCampaign.get(s.campaignId) || [];
      list.push(s);
      byCampaign.set(s.campaignId, list);
    }
    const byAdset = new Map<string, AdRow[]>();
    for (const a of data.ads) {
      const list = byAdset.get(a.adsetId) || [];
      list.push(a);
      byAdset.set(a.adsetId, list);
    }
    return { adsetsByCampaign: byCampaign, adsByAdset: byAdset };
  }, [data.adsets, data.ads]);

  // Wyszukiwarka: kampania widoczna gdy pasuje jej nazwa albo nazwa
  // któregoś zestawu/reklamy w środku; pasujące gałęzie auto-rozwinięte.
  const q = query.trim().toLowerCase();
  const search = useMemo(() => {
    if (!q) return null;
    const nameMatchCampaigns = new Set<string>();
    const nameMatchAdsets = new Set<string>();
    const autoOpenCampaigns = new Set<string>();
    const autoOpenAdsets = new Set<string>();
    for (const c of baseCampaigns) {
      if (c.campaignName.toLowerCase().includes(q)) nameMatchCampaigns.add(c.campaignId);
    }
    for (const s of data.adsets) {
      if (s.adsetName.toLowerCase().includes(q)) {
        nameMatchAdsets.add(s.adsetId);
        autoOpenCampaigns.add(s.campaignId);
      }
    }
    for (const a of data.ads) {
      if (a.adName.toLowerCase().includes(q)) {
        autoOpenCampaigns.add(a.campaignId);
        autoOpenAdsets.add(a.adsetId);
      }
    }
    return { nameMatchCampaigns, nameMatchAdsets, autoOpenCampaigns, autoOpenAdsets };
  }, [q, baseCampaigns, data.adsets, data.ads]);

  const visibleCampaigns = search
    ? baseCampaigns.filter(c => search.nameMatchCampaigns.has(c.campaignId) || search.autoOpenCampaigns.has(c.campaignId))
    : baseCampaigns;

  const isCampaignOpen = (id: string) =>
    search ? (search.autoOpenCampaigns.has(id) || openCampaigns.has(id)) : openCampaigns.has(id);
  const isAdsetOpen = (id: string) =>
    search ? (search.autoOpenAdsets.has(id) || openAdsets.has(id)) : openAdsets.has(id);

  const visibleAdsets = (c: CampaignRow): AdsetRow[] => {
    const all = adsetsByCampaign.get(c.campaignId) || [];
    if (!search || search.nameMatchCampaigns.has(c.campaignId)) return all;
    return all.filter(s =>
      search.nameMatchAdsets.has(s.adsetId) ||
      (adsByAdset.get(s.adsetId) || []).some(a => a.adName.toLowerCase().includes(q))
    );
  };

  const visibleAds = (s: AdsetRow, campaignNameMatched: boolean): AdRow[] => {
    const all = adsByAdset.get(s.adsetId) || [];
    if (!search || campaignNameMatched || search.nameMatchAdsets.has(s.adsetId)) return all;
    return all.filter(a => a.adName.toLowerCase().includes(q));
  };

  function toggle(set: Set<string>, id: string, apply: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  }

  const exportBase = `/api/dashboard/marketing/export?date_from=${dateFrom}&date_to=${dateTo}&shop=${encodeURIComponent(shop)}`;

  return (
    <div className="space-y-3">
      {/* Pasek narzędzi */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Szukaj kampanii, zestawu, reklamy…"
            className="input w-72 max-w-full pl-9"
          />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {allCampaignTags.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              Tag:
              <select
                value={tagFilter}
                onChange={e => setTagFilter(e.target.value)}
                className="rounded-xl border border-line bg-surface px-2 py-1.5 text-xs text-ink-soft focus:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/10 max-w-[160px]"
              >
                <option value="">wszystkie</option>
                {allCampaignTags.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            Lejek:
            <select
              value={funnelFilter}
              onChange={e => setFunnelFilter(e.target.value)}
              className="rounded-xl border border-line bg-surface px-2 py-1.5 text-xs text-ink-soft focus:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/10"
            >
              <option value="">wszystkie</option>
              {FUNNEL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <AttributionSelect value={attribution} onChange={onAttributionChange} />
          <details className="relative">
            <summary className="btn-secondary gap-1.5 px-3 py-1.5 text-xs cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              <Download size={13} /> Eksport CSV
            </summary>
            <div className="absolute right-0 mt-1 z-20 w-48 rounded-xl border border-line bg-surface shadow-pop animate-scale-in p-1">
              {([
                ['campaigns', 'Kampanie'],
                ['adsets', 'Zestawy reklam'],
                ['ads', 'Reklamy'],
                ['daily', 'Dziennie (surowe)'],
              ] as const).map(([scope, label]) => (
                <a
                  key={scope}
                  href={`${exportBase}&scope=${scope}`}
                  className="block px-3 py-1.5 text-xs text-ink-soft hover:text-ink hover:bg-surface-2 rounded-lg"
                >
                  {label}
                </a>
              ))}
            </div>
          </details>
        </div>
      </div>

      {/* Drzewo */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[1100px]">
          <thead>
            <tr className="border-b border-line bg-surface/80">
              <th className="px-4 py-3 text-left font-medium text-ink-muted whitespace-nowrap">
                Kampania / Zestaw / Reklama
              </th>
              {METRIC_HEADERS.map(h => (
                <th
                  key={h.key}
                  title={h.hint}
                  className="px-3 py-3 text-right font-medium text-ink-muted whitespace-nowrap cursor-help underline decoration-dotted decoration-line underline-offset-4"
                >
                  {h.label}
                </th>
              ))}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {visibleCampaigns.length === 0 && (
              <tr>
                <td colSpan={METRIC_HEADERS.length + 2} className="px-4 py-8 text-center text-ink-muted">
                  {q || tagFilter || funnelFilter ? 'Nic nie znaleziono — zmień wyszukiwanie lub filtry' : 'Brak kampanii w tym zakresie'}
                </td>
              </tr>
            )}
            {visibleCampaigns.map(c => {
              const open = isCampaignOpen(c.campaignId);
              const adsets = adsetsByCampaign.get(c.campaignId) || [];
              const adCount = adsets.reduce((n, s) => n + (adsByAdset.get(s.adsetId)?.length || 0), 0);
              const campaignNameMatched = !!search?.nameMatchCampaigns.has(c.campaignId);
              return (
                <CampaignBranch
                  key={c.campaignId}
                  campaign={c}
                  open={open}
                  adsetCount={adsets.length}
                  adCount={adCount}
                  attribution={attribution}
                  onToggle={() => toggle(openCampaigns, c.campaignId, setOpenCampaigns)}
                  onEdit={() => setEditing(c)}
                >
                  {open && visibleAdsets(c).map(s => {
                    const sOpen = isAdsetOpen(s.adsetId);
                    const ads = visibleAds(s, campaignNameMatched);
                    return (
                      <AdsetBranch
                        key={s.adsetId}
                        adset={s}
                        open={sOpen}
                        adCount={(adsByAdset.get(s.adsetId) || []).length}
                        attribution={attribution}
                        onToggle={() => toggle(openAdsets, s.adsetId, setOpenAdsets)}
                      >
                        {sOpen && ads.map(a => (
                          <AdLeaf key={a.adId} ad={a} attribution={attribution} onClick={() => setSelectedAd(a)} />
                        ))}
                      </AdsetBranch>
                    );
                  })}
                </CampaignBranch>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-faint">
        Najedź na nagłówek kolumny, żeby zobaczyć co oznacza metryka. Kampanie posortowane wg wydatków.
      </p>

      {editing && (
        <CampaignMetaEditor
          campaign={editing}
          onClose={() => setEditing(null)}
          onSaved={fields => {
            onMetaSaved(editing.campaignId, fields);
            setEditing(null);
          }}
        />
      )}
      {selectedAd && (
        <AdPreviewModal
          key={selectedAd.adId}
          ad={selectedAd}
          dateFrom={dateFrom}
          dateTo={dateTo}
          attribution={attribution}
          onClose={() => setSelectedAd(null)}
          onCreativeSaved={onCreativeSaved}
        />
      )}
    </div>
  );
}

// ── Wiersze ──────────────────────────────────────────────────────

function MetricCells({ m, attribution, strong }: { m: Metrics; attribution: AttributionWindow; strong?: boolean }) {
  const att = attributed(m, attribution);
  const cell = cn('px-3 py-2.5 text-right whitespace-nowrap font-mono', strong ? 'text-ink font-medium' : 'text-ink-soft');
  return (
    <>
      <td className={cell}>{formatCurrency(m.spend)}</td>
      <td className={cell}>{formatNumber(m.reach)}</td>
      <td className={cell}>{m.cpm.toFixed(2)} zł</td>
      <td className={cell}>{m.ctr.toFixed(2)}%</td>
      <td className={cell}>{m.leads > 0 ? formatNumber(m.leads) : '—'}</td>
      <td className={cell}>{m.cpl > 0 ? `${m.cpl.toFixed(2)} zł` : '—'}</td>
      <td className={cell}>{formatNumber(att.purchases)}</td>
      <td className={cell}>{formatCurrency(att.revenue)}</td>
      <td className={cn(cell, 'font-semibold', att.roas >= 1 ? 'text-emerald-600' : att.roas > 0 ? 'text-red-600' : 'text-ink-faint')}>
        {att.roas > 0 ? `${att.roas.toFixed(2)}×` : '—'}
      </td>
    </>
  );
}

function CampaignBranch({
  campaign, open, adsetCount, adCount, attribution, onToggle, onEdit, children,
}: {
  campaign: CampaignRow;
  open: boolean;
  adsetCount: number;
  adCount: number;
  attribution: AttributionWindow;
  onToggle: () => void;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr
        className="border-b border-line/70 hover:bg-surface-2/60 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            {open ? <ChevronDown size={15} className="text-ink-muted shrink-0" /> : <ChevronRight size={15} className="text-ink-muted shrink-0" />}
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-ink font-medium truncate max-w-[340px]" title={campaign.campaignName}>
                  {campaign.campaignName}
                </span>
                {campaign.notes && (
                  <span title={campaign.notes}><StickyNote size={13} className="text-amber-500 shrink-0" /></span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[10px] text-ink-faint">{campaign.shop}</span>
                {campaign.objective && (
                  <span className="text-[10px] px-1.5 py-px rounded bg-surface-2 border border-line text-ink-soft">
                    {OBJECTIVE_LABELS[campaign.objective] || campaign.objective}
                  </span>
                )}
                {campaign.funnelStage && (
                  <span className={cn('text-[10px] px-1.5 py-px rounded font-medium', FUNNEL_BADGE[campaign.funnelStage] || 'bg-surface-2 text-ink-soft')}>
                    {campaign.funnelStage}
                  </span>
                )}
                {campaign.tags.slice(0, 4).map(tag => (
                  <span key={tag} className="text-[10px] px-1.5 py-px rounded-full bg-primary-soft text-primary-ink">
                    {tag}
                  </span>
                ))}
                {campaign.tags.length > 4 && (
                  <span className="text-[10px] text-ink-faint" title={campaign.tags.join(', ')}>
                    +{campaign.tags.length - 4}
                  </span>
                )}
                {campaign.purpose && (
                  <span className="text-[10px] text-ink-faint italic truncate max-w-[200px]" title={campaign.purpose}>
                    {campaign.purpose}
                  </span>
                )}
                <span className="text-[10px] text-ink-faint">· {adsetCount} zest. · {adCount} rekl.</span>
              </div>
            </div>
          </div>
        </td>
        <MetricCells m={campaign} attribution={attribution} strong />
        <td className="px-2 py-2.5 text-right">
          <button
            onClick={e => { e.stopPropagation(); onEdit(); }}
            title="Edytuj cel wewnętrzny / etap lejka / notatkę"
            className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface-2 transition-colors"
          >
            <Pencil size={13} />
          </button>
        </td>
      </tr>
      {children}
    </>
  );
}

function AdsetBranch({
  adset, open, adCount, attribution, onToggle, children,
}: {
  adset: AdsetRow;
  open: boolean;
  adCount: number;
  attribution: AttributionWindow;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr
        className="border-b border-line/50 bg-surface-2/40 hover:bg-surface-2/60 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="px-4 py-2">
          <div className="flex items-center gap-2 pl-6 min-w-0">
            {open ? <ChevronDown size={14} className="text-ink-muted shrink-0" /> : <ChevronRight size={14} className="text-ink-muted shrink-0" />}
            <span className="text-ink-soft truncate max-w-[320px]" title={adset.adsetName}>{adset.adsetName}</span>
            <span className="text-[10px] text-ink-faint shrink-0">· {adCount} rekl.</span>
          </div>
        </td>
        <MetricCells m={adset} attribution={attribution} />
        <td />
      </tr>
      {children}
    </>
  );
}

function AdLeaf({ ad, attribution, onClick }: { ad: AdRow; attribution: AttributionWindow; onClick: () => void }) {
  return (
    <tr
      className="border-b border-line/40 bg-surface-2/70 hover:bg-primary-soft cursor-pointer transition-colors"
      onClick={onClick}
      title="Kliknij, aby zobaczyć podgląd kreacji"
    >
      <td className="px-4 py-2">
        <div className="flex items-center gap-2.5 pl-14 min-w-0">
          <CreativeThumb ad={ad} size={28} />
          <span className="text-ink-soft truncate max-w-[300px]" title={ad.adName}>{ad.adName}</span>
          {ad.creative?.format && (
            <span className="text-[9px] font-medium px-1 py-px rounded bg-primary-soft text-primary-ink shrink-0">
              {ad.creative.format}
            </span>
          )}
        </div>
      </td>
      <MetricCells m={ad} attribution={attribution} />
      <td />
    </tr>
  );
}
