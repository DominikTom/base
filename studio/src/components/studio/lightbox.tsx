'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';

const MAX_ZOOM = 6;

/**
 * Pełnoekranowy podgląd obrazu w aplikacji (zamiast otwierania nowej karty).
 * Zoom: kółko do kursora, dwuklik 2×, pinch dwoma palcami; przeciąganie
 * przesuwa przybliżony obraz. Przy zoomie 1 klik w tło zamyka.
 */
export function Lightbox({
  imageUrl,
  downloadUrl,
  onClose,
}: {
  imageUrl: string;
  downloadUrl?: string;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const state = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  state.current = { zoom, pan };

  /** Aktywne wskaźniki (pinch = dwa). */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ panX: number; panY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const pinchStart = useRef<{ dist: number; zoom: number; center: { x: number; y: number } } | null>(null);
  /** Zamknięcie z opóźnieniem — pojedynczy klik czeka, czy nie nadejdzie dwuklik (zoom). */
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, [onClose]);

  /** Zoom wokół punktu (współrzędne względem kontenera). */
  function zoomAt(point: { x: number; y: number }, newZoomRaw: number) {
    const { zoom: z, pan: p } = state.current;
    const newZoom = Math.min(MAX_ZOOM, Math.max(1, newZoomRaw));
    if (newZoom === 1) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const s = { x: (point.x - p.x) / z, y: (point.y - p.y) / z };
    setZoom(newZoom);
    setPan({ x: point.x - s.x * newZoom, y: point.y - s.y * newZoom });
  }

  function relPoint(clientX: number, clientY: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: 0, y: 0 };
  }

  // Kółko — natywny listener (React traktuje wheel jako pasywny).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      zoomAt(relPoint(e.clientX, e.clientY), state.current.zoom * factor);
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = {
        dist: Math.hypot(b.x - a.x, b.y - a.y),
        zoom: state.current.zoom,
        center: relPoint((a.x + b.x) / 2, (a.y + b.y) / 2),
      };
      gesture.current = null;
    } else if (pointers.current.size === 1) {
      gesture.current = {
        panX: state.current.pan.x,
        panY: state.current.pan.y,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (pinchStart.current.dist > 0) {
        zoomAt(pinchStart.current.center, pinchStart.current.zoom * (dist / pinchStart.current.dist));
      }
    } else if (gesture.current && state.current.zoom > 1) {
      const dx = e.clientX - gesture.current.startX;
      const dy = e.clientY - gesture.current.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) gesture.current.moved = true;
      setPan({ x: gesture.current.panX + dx, y: gesture.current.panY + dy });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    const g = gesture.current;
    gesture.current = null;
    // Tap/klik bez przesunięcia przy zoomie 1 — zamknij podgląd (z małym
    // opóźnieniem, żeby dwuklik zdążył je anulować i przybliżyć zamiast zamykać).
    if (g && !g.moved && state.current.zoom === 1 && e.target === e.currentTarget) {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(onClose, 280);
    }
  }

  function onDoubleClick(e: React.MouseEvent) {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    const point = relPoint(e.clientX, e.clientY);
    zoomAt(point, state.current.zoom > 1 ? 1 : 2);
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[90] overflow-hidden bg-black/85 backdrop-blur-sm"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      role="dialog"
      aria-modal="true"
      style={{ touchAction: 'none' }}
    >
      <div
        className="pointer-events-none flex h-full w-full items-center justify-center p-6"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Podgląd pełnoekranowy"
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          draggable={false}
        />
      </div>
      <div className="absolute right-4 top-4 flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
        {zoom > 1 && (
          <button
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
          >
            {Math.round(zoom * 100)}%
          </button>
        )}
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
      <p className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white/70">
        kółko / dwuklik / uszczypnięcie = zoom · Esc = zamknij
      </p>
    </div>
  );
}
