'use client';

import { useState } from 'react';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { Play, Image as ImageIcon, Layers, HelpCircle, Wand2, Package } from 'lucide-react';

export interface VideoRetention {
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  p100: number;
}

export interface CreativeCardData {
  creative_id: string;
  title: string | null;
  body?: string | null;
  thumbnail_url: string | null;
  image_url?: string | null;        // full-res (preferred) — low-res fallback: thumbnail_url
  permalink_url?: string | null;    // link do postu na FB, "otwórz w Meta Ad Library"
  video_id?: string | null;
  format: string;
  ai_tags: string[];
  ai_insights?: Record<string, unknown> | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value?: number;
  roas: number;
  ctr: number;
  hook_rate?: number;
  cpa?: number;
  first_seen_at?: string | null;
  account_id?: string | null;
  video_retention?: VideoRetention | null;
}

function FormatBadge({ format }: { format: string }) {
  const cfg: Record<string, { icon: React.ReactNode; cls: string; label: string }> = {
    video: { icon: <Play size={10} />, cls: 'bg-purple-500/20 text-purple-300', label: 'Video' },
    image: { icon: <ImageIcon size={10} />, cls: 'bg-blue-500/20 text-blue-300', label: 'Image' },
    carousel: { icon: <Layers size={10} />, cls: 'bg-amber-500/20 text-amber-300', label: 'Carousel' },
    dynamic: { icon: <Wand2 size={10} />, cls: 'bg-fuchsia-500/20 text-fuchsia-300', label: 'DPA' },
    unknown: { icon: <HelpCircle size={10} />, cls: 'bg-zinc-700 text-zinc-400', label: '?' },
  };
  const c = cfg[format] || cfg.unknown;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${c.cls}`}>
      {c.icon}
      {c.label}
    </span>
  );
}

function formatDaysAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return 'dziś';
  if (days === 1) return 'wczoraj';
  if (days < 30) return `${days} dni`;
  return `${Math.floor(days / 30)} mies.`;
}

export function CreativeCard({ data, onClick }: { data: CreativeCardData; onClick?: () => void }) {
  // Strategia HD preview:
  // - VIDEO: zawsze przez /api/meta/video-poster/{id} (dynamic HD z Meta,
  //   bez polegania na zapisanym thumbnail_url który może być stary/low-res).
  // - STATIC: image_url (full-res) z fallbackiem na thumbnail_url.
  const previewUrl = data.video_id
    ? `/api/meta/video-poster/${data.video_id}`
    : (data.image_url && data.image_url.length > 0)
      ? data.image_url
      : data.thumbnail_url;
  const [imgError, setImgError] = useState(false);
  const roasColor =
    data.roas >= 3 ? 'text-emerald-400' :
    data.roas >= 1 ? 'text-zinc-300' : 'text-red-400';
  const daysAgo = formatDaysAgo(data.first_seen_at);

  return (
    <button
      onClick={onClick}
      className="group flex flex-col text-left bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-600 transition-colors"
    >
      {/* Thumbnail */}
      <div className="relative aspect-[4/5] bg-zinc-950 overflow-hidden">
        {previewUrl && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={data.title || 'Creative'}
            loading="lazy"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
          />
        ) : data.format === 'dynamic' ? (
          // DPA = template, Meta nie zwraca thumbnail. Fioletowy placeholder z info.
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-fuchsia-950/40 to-zinc-950 text-fuchsia-300/70">
            <Package size={32} />
            <span className="text-[10px] font-medium tracking-wide">SZABLON KATALOGOWY</span>
            <span className="text-[10px] text-zinc-500 px-3 text-center leading-snug">
              Meta renderuje produkty<br />dynamicznie z katalogu
            </span>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-700">
            <ImageIcon size={32} />
          </div>
        )}
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <FormatBadge format={data.format} />
          {daysAgo && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-black/60 text-zinc-300 backdrop-blur-sm">
              {daysAgo}
            </span>
          )}
        </div>
      </div>

      {/* Metrics row */}
      <div className="p-3 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-zinc-500">Spend</span>
          <span className="text-sm font-semibold text-zinc-100 tabular-nums">{formatCurrency(data.spend)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-zinc-500">ROAS</span>
          <span className={`text-sm font-semibold tabular-nums ${roasColor}`}>{data.roas.toFixed(2)}x</span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-zinc-500">CTR</span>
          <span className="text-sm text-zinc-300 tabular-nums">{data.ctr.toFixed(2)}%</span>
        </div>
        {data.hook_rate !== undefined && data.hook_rate > 0 && (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-zinc-500">Hook</span>
            <span className="text-sm text-zinc-300 tabular-nums">{data.hook_rate.toFixed(1)}%</span>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-zinc-500">Konwersje</span>
          <span className="text-sm text-zinc-300 tabular-nums">{formatNumber(data.conversions)}</span>
        </div>
      </div>

      {/* AI tags */}
      {data.ai_tags.length > 0 && (
        <div className="px-3 pb-3 flex flex-wrap gap-1">
          {data.ai_tags.slice(0, 4).map(tag => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
              {tag}
            </span>
          ))}
          {data.ai_tags.length > 4 && (
            <span className="text-[10px] px-1.5 py-0.5 text-zinc-500">
              +{data.ai_tags.length - 4}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
