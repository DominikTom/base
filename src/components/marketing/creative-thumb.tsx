'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ImageOff, Play } from 'lucide-react';
import { imageProxyUrl, imageProxyByAdUrl, type AdRow } from './types';

// Miniatura kreacji przez proxy obrazków. Samonaprawiająca się: gdy podpisany
// URL fbcdn wygaśnie (onError), przełącza się na tryb ?adId=, który pobiera
// świeży URL prosto z Meta API. Ostatni fallback: placeholder.
export function CreativeThumb({ ad, size = 48, className }: { ad: AdRow; size?: number; className?: string }) {
  const rawUrl = ad.creative?.thumbnailUrl || ad.creative?.imageUrl || null;
  const initialSrc = rawUrl ? imageProxyUrl(rawUrl, ad.accountId) : imageProxyByAdUrl(ad.adId, ad.accountId);
  const [src, setSrc] = useState<string | null>(initialSrc);

  // Reset przy zmianie reklamy — wzorzec „adjust state during render”
  // (bez efektu; React zachowuje stan przy tym samym typie elementu)
  const [prevInitialSrc, setPrevInitialSrc] = useState(initialSrc);
  if (prevInitialSrc !== initialSrc) {
    setPrevInitialSrc(initialSrc);
    setSrc(initialSrc);
  }

  const isVideo = ad.creative?.format === 'video';

  if (!src) {
    return (
      <div
        className={cn('flex items-center justify-center rounded-lg bg-surface-2 border border-line text-ink-faint shrink-0', className)}
        style={{ width: size, height: size }}
      >
        <ImageOff size={Math.max(14, size / 3)} />
      </div>
    );
  }

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- dynamiczne proxy, poza optymalizacją next/image */}
      <img
        src={src}
        alt={ad.adName}
        width={size}
        height={size}
        loading="lazy"
        className="w-full h-full object-cover rounded-lg bg-surface-2 border border-line"
        onError={() => {
          const byAd = imageProxyByAdUrl(ad.adId, ad.accountId);
          setSrc(prev => (prev !== byAd ? byAd : null));
        }}
      />
      {isVideo && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="bg-black/50 rounded-full p-1">
            <Play size={Math.max(10, size / 5)} className="text-white" fill="currentColor" />
          </span>
        </span>
      )}
    </div>
  );
}
