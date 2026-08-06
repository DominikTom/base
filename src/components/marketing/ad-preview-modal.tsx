'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { X, ImageOff, ExternalLink } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import type { AttributionWindow } from '@/lib/marketing-constants';
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
}

// Modal podglądu reklamy — trzy warstwy próbowane w tej kolejności:
//   1. natywny podgląd Meta (iframe z /previews) — pełna, interaktywna reklama
//   2. odtwarzacz wideo HD przez własny proxy (omija podgląd 64×64)
//   3. obraz statyczny przez proxy obrazków (z samonaprawą po wygaśnięciu URL)
// Podgląd i dane dzienne ładują się równolegle, każde z własnym spinnerem.
// Renderuj z key={ad.adId} — zmiana reklamy resetuje stan przez remount.
export function AdPreviewModal({ ad, dateFrom, dateTo, attribution, onClose }: AdPreviewModalProps) {
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 overflow-y-auto py-8 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-4 border-b border-zinc-800">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-zinc-100 truncate">{ad.adName}</h3>
            <p className="text-xs text-zinc-500 mt-0.5 truncate">
              {ad.shop} · {ad.campaignName} · {ad.adsetName}
            </p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {ad.creative?.format && (
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                  {ad.creative.format}
                </span>
              )}
              {(ad.creative?.tags || []).slice(0, 6).map(tag => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Podgląd: iframe → wideo HD → obraz → placeholder */}
        <div className="p-4">
          {previewLoading ? (
            <div className="flex items-center justify-center bg-zinc-950 rounded-lg" style={{ minHeight: 400 }}>
              <div className="animate-pulse text-zinc-500 text-sm">Ładowanie podglądu…</div>
            </div>
          ) : previewHtml ? (
            <div
              className="flex justify-center bg-zinc-950 rounded-lg overflow-hidden [&>iframe]:!max-w-full [&>iframe]:!border-0"
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
              className="aspect-video w-full object-contain bg-zinc-950 rounded-lg"
            />
          ) : rawImage && !imgFailed ? (
            /* eslint-disable-next-line @next/next/no-img-element -- proxy Meta, poza next/image */
            <img
              src={imageProxyUrl(rawImage, ad.accountId)}
              alt={ad.adName}
              className="w-full max-h-[480px] object-contain bg-zinc-950 rounded-lg"
              onError={e => {
                const t = e.target as HTMLImageElement;
                if (!t.src.includes('adId=')) t.src = imageProxyByAdUrl(ad.adId, ad.accountId);
                else setImgFailed(true);
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 bg-zinc-950 rounded-lg text-zinc-600" style={{ minHeight: 240 }}>
              <ImageOff size={32} />
              <span className="text-xs">Podgląd niedostępny{ad.creative?.isDynamic ? ' (kreacja dynamiczna)' : ''}</span>
            </div>
          )}
          <p className="text-[11px] text-zinc-600 text-center mt-2">
            Podgląd na żywo · ten sam widok co feed Facebooka · odświeżany przy każdym otwarciu
          </p>
        </div>

        {/* Copy */}
        {ad.creative?.body && (
          <div className="px-4 pb-3">
            <p className="text-xs text-zinc-400 whitespace-pre-line line-clamp-4">{ad.creative.body}</p>
          </div>
        )}

        {/* KPI */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 pb-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Wydatki</div>
            <div className="text-lg font-semibold text-zinc-100 mt-0.5">{formatNumber(ad.spend, 2)} zł</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">Zakupy</div>
            <div className="text-lg font-semibold text-zinc-100 mt-0.5">{formatNumber(att.purchases)}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">ROAS</div>
            <div className="text-lg font-semibold text-emerald-400 mt-0.5">{att.roas.toFixed(2)}×</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">CTR</div>
            <div className="text-lg font-semibold text-zinc-100 mt-0.5">{ad.ctr.toFixed(2)}%</div>
          </div>
        </div>

        {/* Spend — daily */}
        <div className="px-4 pb-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-xs font-medium text-zinc-400 mb-2">
              Wydatki — dziennie <span className="text-zinc-600">{dateFrom} – {dateTo}</span>
            </div>
            {daily === null ? (
              <div className="h-32 flex items-center justify-center text-zinc-600 text-xs animate-pulse">Ładowanie…</div>
            ) : daily.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-zinc-600 text-xs">Brak danych dziennych</div>
            ) : (
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={daily} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#71717a' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#71717a' }} tickLine={false} axisLine={false} width={45} />
                  <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', fontSize: '12px' }} />
                  <Line type="monotone" dataKey="spend" name="Wydatki" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 pb-4">
          <span className="text-[11px] text-zinc-600">
            Zakres: {dateFrom} – {dateTo}
          </span>
          <a
            href={`https://www.facebook.com/adsmanager/manage/ads?act=${ad.accountId.replace('act_', '')}&selected_ad_ids=${ad.adId}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <ExternalLink size={13} /> Otwórz w Ads Manager
          </a>
        </div>
      </div>
    </div>
  );
}
