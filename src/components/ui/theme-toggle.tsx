'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Sun, Moon, Monitor, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ThemeMode = 'light' | 'dark' | 'system';

let listeners: Array<() => void> = [];

function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter(l => l !== cb);
  };
}

function readTheme(): ThemeMode {
  try {
    const t = localStorage.getItem('theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

function serverTheme(): ThemeMode {
  return 'system';
}

function applyTheme(mode: ThemeMode) {
  const dark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function useTheme() {
  const mode = useSyncExternalStore(subscribe, readTheme, serverTheme);

  // Tryb systemowy podąża za preferencją OS bez przeładowania
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (readTheme() === 'system') applyTheme('system');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const set = useCallback((m: ThemeMode) => {
    try {
      if (m === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', m);
    } catch {}
    applyTheme(m);
    for (const l of listeners) l();
  }, []);

  return { mode, set };
}

const MODES: { value: ThemeMode; icon: LucideIcon; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Jasny' },
  { value: 'dark', icon: Moon, label: 'Ciemny' },
  { value: 'system', icon: Monitor, label: 'Systemowy' },
];

export function ThemeToggle({
  variant = 'cycle',
  className,
}: {
  variant?: 'cycle' | 'segmented';
  className?: string;
}) {
  const { mode, set } = useTheme();

  if (variant === 'segmented') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1 rounded-xl border border-line bg-surface p-1 shadow-card',
          className
        )}
      >
        {MODES.map(m => (
          <button
            key={m.value}
            type="button"
            title={m.label}
            aria-label={m.label}
            onClick={() => set(m.value)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink',
              mode === m.value && 'bg-surface-2 text-ink'
            )}
          >
            <m.icon size={14} />
          </button>
        ))}
      </div>
    );
  }

  const idx = MODES.findIndex(m => m.value === mode);
  const current = MODES[idx === -1 ? 2 : idx];
  const next = MODES[(idx + 1) % MODES.length];
  return (
    <button
      type="button"
      onClick={() => set(next.value)}
      title={`Motyw: ${current.label}`}
      aria-label="Przełącz motyw"
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink',
        className
      )}
    >
      <current.icon size={16} />
    </button>
  );
}
