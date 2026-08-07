'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { X, ImageOff, ExternalLink, Tags } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import type { AttributionWindow } from '@/lib/marketing-constants';
import { TagInput } from './tag-input';
import {
  attributed, imageProxyUrl, imageProxyByAdUrl,
  type AdRow, type AdDailyPoint,
} from './types';

interface AdPreviewModalProps {
  ad: AdRow;
  dateFrom: string;
  dateTo: string;
  attribution: AttributionWindow;
  onClose: () => void;
  // Zapis własnych tagów/notatki kreacji — rodzic aktualizuje payload
  onCreativeSaved?: (creativeId: string, fields: { manualTags: string[]; manualNotes: string | null }) => void;
}

// Modal podglądu reklamy — trzy warstwy próbowane w tej kolejności:
//   1. natywny podgląd Meta (iframe z /previews) — pełna, interaktywna reklama
//   2. odtwarzacz wideo HD przez własny proxy (omija podgląd 64×64)
//   3. obraz statyczny przez proxy obrazków (z samonaprawą po wygaśnięciu URL)
// Podgląd i dane dzienne ładują się równolegle, każde z własnym spinnerem.
// Renderuj z key={ad.adId} — zmiana reklamy resetuje stan przez remount.
export function AdPreviewModal({ ad, dateFrom, dateTo, attribution, onClose, onCreativeSaved }: AdPreviewModalProps) {
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [daily, setDaily] = useState<AdDailyPoint[] | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/dashboard/meta/preview?adId=${ad.adId}&account=${encodeURIComponent(ad.accountId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(json => { if (!cancelled) setPreviewHtml(json?.preview || null); })
      .catch(() => { if (!cancelled) setPreviewHtml(null); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });

    fetch(`/api/dashboard/marketing/ad-daily?ad_id=${ad.adId}&date_from=${dateFrom}&date_to=${dateTo}`)
      .then(r => (r.ok ? r.json() : null))
      .then(json => { if (!cancelled) setDaily(json?.daily || []); })
      .catch(() => { if (!cancelled) setDaily([]); });

    return () => { cancelled = true; };
  }, [ad.adId, ad.accountId, dateFrom, dateTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const att = attributed(ad, attribution);
  const videoId = ad.creative?.videoId;
  const rawImage = ad.creative?.imageUrl || ad.creative?.thumbnailUrl;
  const posterUrl = ad.creative?.thumbnailUrl
    ? imageProxyUrl(ad.creative.thumbnailUrl, ad.accountId)
    : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-card border border-line bg-surface shadow-pop"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-4 border-b border-line">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-fg truncate">{ad.adName}</h3>
            <p className="text-xs text-muted mt-0.5 truncate">
              {ad.shop} · {ad.campaignName} · {ad.adsetName}
            </p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {ad.creative?.format && (
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary-100 text-primary-800">
                  {ad.creative.format}
                </span>
              )}
              {(ad.creative?.tags || []).slice(0, 6).map(tag => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-bg text-muted border border-line">
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-bg transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Podgląd: iframe → wideo HD → obraz → placeholder */}
        <div className="p-4">
          {previewLoading ? (
            <div className="flex items-center justify-center bg-bg rounded-lg" style={{ minHeight: 400 }}>
              <div className="animate-pulse text-muted text-sm">Ładowanie podglądu…</div>
            </div>
          ) : previewHtml ? (
            <div
              className="flex justify-center bg-bg rounded-lg overflow-hidden [&>iframe]:!max-w-full [&>iframe]:!border-0"
              style={{ minHeight: 400 }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : videoId ? (
            <video
              src={`/api/dashboard/meta/video/${videoId}?account=${encodeURIComponent(ad.accountId)}`}
              poster={posterUrl}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full object-contain bg-bg rounded-lg"
            />
          ) : rawImage && !imgFailed ? (
            /* eslint-disable-next-line @next/next/no-img-element -- proxy Meta, poza next/image */
            <img
              src={imageProxyUrl(rawImage, ad.accountId)}
              alt={ad.adName}
              className="w-full max-h-[480px] object-contain bg-bg rounded-lg"
              onError={e => {
                const t = e.target as HTMLImageElement;
                if (!t.src.includes('adId=')) t.src = imageProxyByAdUrl(ad.adId, ad.accountId);
                else setImgFailed(true);
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 bg-bg rounded-lg text-muted" style={{ minHeight: 240 }}>
              <ImageOff size={32} />
              <span className="text-xs">Podgląd niedostępny{ad.creative?.isDynamic ? ' (kreacja dynamiczna)' : ''}</span>
            </div>
          )}
          <p className="text-[11px] text-muted text-center mt-2">
            Podgląd na żywo · ten sam widok co feed Facebooka · odświeżany przy każdym otwarciu
          </p>
        </div>

        {/* Copy */}
        {ad.creative?.body && (
          <div className="px-4 pb-3">
            <p className="text-xs text-fg-soft whitespace-pre-line line-clamp-4">{ad.creative.body}</p>
          </div>
        )}

        {/* Własne tagi + notatka kreacji */}
        {ad.creativeId && ad.creative && (
          <CreativeMetaSection
            creativeId={ad.creativeId}
            initialTags={ad.creative.manualTags || []}
            initialNotes={ad.creative.manualNotes || ''}
            onSaved={onCreativeSaved}
          />
        )}

        {/* KPI */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 pb-4">
          <div className="rounded-lg border border-line bg-bg p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted">Wydatki</div>
            <div className="text-lg font-semibold text-fg mt-0.5">{formatNumber(ad.spend, 2)} zł</div>
          </div>
          <div className="rounded-lg border border-line bg-bg p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted">Zakupy</div>
            <div className="text-lg font-semibold text-fg mt-0.5">{formatNumber(att.purchases)}</div>
          </div>
          <div className="rounded-lg border border-line bg-bg p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted">ROAS</div>
            <div className="text-lg font-semibold text-emerald-600 mt-0.5">{att.roas.toFixed(2)}×</div>
          </div>
          <div className="rounded-lg border border-line bg-bg p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted">CTR</div>
            <div className="text-lg font-semibold text-fg mt-0.5">{ad.ctr.toFixed(2)}%</div>
          </div>
        </div>

        {/* Spend — daily */}
        <div className="px-4 pb-4">
          <div className="rounded-lg border border-line bg-bg p-3">
            <div className="text-xs font-medium text-fg-soft mb-2">
              Wydatki — dziennie <span className="text-muted">{dateFrom} – {dateTo}</span>
            </div>
            {daily === null ? (
              <div className="h-32 flex items-center justify-center text-muted text-xs animate-pulse">Ładowanie…</div>
            ) : daily.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-muted text-xs">Brak danych dziennych</div>
            ) : (
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={daily} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EAEBE8" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#8B908C' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#8B908C' }} tickLine={false} axisLine={false} width={45} />
                  <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #ECEDEB', borderRadius: '8px', fontSize: '12px' }} />
                  <Line type="monotone" dataKey="spend" name="Wydatki" stroke="#A855F7" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 pb-4">
          <span className="text-[11px] text-muted">
            Zakres: {dateFrom} – {dateTo}
          </span>
          <a
            href={`https://www.facebook.com/adsmanager/manage/ads?act=${ad.accountId.replace('act_', '')}&selected_ad_ids=${ad.adId}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-fg-soft hover:text-fg transition-colors"
          >
            <ExternalLink size={13} /> Otwórz w Ads Manager
          </a>
        </div>
      </div>
    </div>
  );
}

// Własne tagi + notatka kreacji, zapisywane do dim_creatives (manual_tags /
// manual_notes). Filtrowanie w zakładce Kreacje działa po unii tagów
// auto + AI + manualnych.
function CreativeMetaSection({
  creativeId, initialTags, initialNotes, onSaved,
}: {
  creativeId: string;
  initialTags: string[];
  initialNotes: string;
  onSaved?: (creativeId: string, fields: { manualTags: string[]; manualNotes: string | null }) => void;
}) {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = notes !== initialNotes
    || tags.length !== initialTags.length
    || tags.some((t, i) => t !== initialTags[i]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/dashboard/marketing/creative-meta', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creative_id: creativeId, tags, notes: notes.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setSaved(true);
      onSaved?.(creativeId, { manualTags: tags, manualNotes: notes.trim() || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 pb-4">
      <div className="rounded-lg border border-line bg-bg p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-fg-soft">
          <Tags size={13} className="text-muted" /> Twoje tagi i notatka kreacji
        </div>
        <TagInput tags={tags} onChange={t => { setTags(t); setSaved(false); }} placeholder="np. UGC, blackweek, test hooka…" />
        <input
          value={notes}
          onChange={e => { setNotes(e.target.value); setSaved(false); }}
          maxLength={300}
          placeholder="Krótka notatka (opcjonalnie)"
          className="w-full px-3 py-2 rounded-lg bg-surface border border-line text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted">
            {error ? <span className="text-danger">{error}</span> : saved ? 'Zapisano ✓' : 'Tagi działają w filtrach zakładki Kreacje i w CSV'}
          </span>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="px-3 py-1.5 text-xs rounded-lg btn-primary-gradient"
          >
            {saving ? 'Zapisywanie…' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}
