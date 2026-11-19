'use client';

import { useId } from 'react';

// Kółko z gradientem indygo->cyjan (135deg). Identyfikator gradientu musi
// być unikalny per instancja (useId) — duplikaty ID + instancja w
// display:none sprawiają, że Chrome nie maluje gradientu w widocznych kopiach.
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: 'rgb(var(--primary))' }} />
          <stop offset="100%" style={{ stopColor: 'rgb(var(--accent))' }} />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="16" fill={`url(#${id})`} />
    </svg>
  );
}
