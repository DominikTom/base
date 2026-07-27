'use client';

import { useEffect } from 'react';
import { Download, X } from 'lucide-react';

/** Pełnoekranowy podgląd obrazu w aplikacji (zamiast otwierania nowej karty). */
export function Lightbox({
  imageUrl,
  downloadUrl,
  onClose,
}: {
  imageUrl: string;
  downloadUrl?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt="Podgląd pełnoekranowy"
        className="max-h-full max-w-full cursor-zoom-out rounded-lg object-contain shadow-2xl"
      />
      <div className="absolute right-4 top-4 flex items-center gap-2">
        {downloadUrl && (
          <a
            href={downloadUrl}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
          >
            <Download className="h-4 w-4" /> Pobierz
          </a>
        )}
        <button
          onClick={onClose}
          className="rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
          aria-label="Zamknij podgląd"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
