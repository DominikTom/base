'use client';

import { cn } from '@/lib/utils';

// Kolor wyliczany deterministycznie z hasha nazwy — ta sama osoba wygląda
// identycznie wszędzie. Paleta 9 pełnych, kryjących teł, inicjały białe.
const AVATAR_BG = [
  'bg-avatar-1',
  'bg-avatar-2',
  'bg-avatar-3',
  'bg-avatar-4',
  'bg-avatar-5',
  'bg-avatar-6',
  'bg-avatar-7',
  'bg-avatar-8',
  'bg-avatar-9',
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initialsOf(name: string): string {
  const base = name.includes('@') ? name.split('@')[0] : name;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  size = 28,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const bg = AVATAR_BG[hashString(name) % AVATAR_BG.length];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none',
        bg,
        className
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
      title={name}
    >
      {initialsOf(name)}
    </span>
  );
}
