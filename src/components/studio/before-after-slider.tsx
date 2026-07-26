'use client';

import { useRef, useState } from 'react';

/** Porównanie "przed / po" — pionowy uchwyt przesuwany myszą/dotykiem. */
export function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  beforeLabel = 'Przed',
  afterLabel = 'Po',
}: {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50);
  const dragging = useRef(false);

  function updateFromEvent(clientX: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.min(100, Math.max(0, pct)));
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full cursor-ew-resize select-none overflow-hidden rounded-xl"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        updateFromEvent(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current) updateFromEvent(e.clientX);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={afterUrl} alt={afterLabel} className="block w-full" draggable={false} />
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={beforeUrl} alt={beforeLabel} className="block w-full" draggable={false} />
      </div>
      <div
        className="absolute bottom-0 top-0 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,0.5)]"
        style={{ left: `${position}%` }}
      >
        <span className="absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-xs font-bold text-studio-ink shadow-md">
          ⇄
        </span>
      </div>
      <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
        {beforeLabel}
      </span>
      <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
        {afterLabel}
      </span>
    </div>
  );
}
