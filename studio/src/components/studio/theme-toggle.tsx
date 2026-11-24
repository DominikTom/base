'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

export const THEME_STORAGE_KEY = 'studio-theme';
const THEME_COLOR: Record<'dark' | 'light', string> = { dark: '#09090b', light: '#f4f4f5' };

/** Ustawia motyw na <html>, w meta theme-color i w localStorage. Domyślny = jasny. */
export function applyTheme(theme: 'dark' | 'light') {
  const root = document.documentElement;
  if (theme === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[theme]);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // tryb prywatny / zablokowany storage — motyw działa do odświeżenia strony
  }
}

/**
 * Przełącznik ciemny ↔ jasny. Stan początkowy czytamy z DOM (ustawia go
 * skrypt anty-migotaniu w layoucie), więc po hydratacji ikona zawsze zgadza
 * się z faktycznym motywem.
 */
export function ThemeToggle({ className, withLabel = false }: { className?: string; withLabel?: boolean }) {
  const [light, setLight] = useState(true);

  useEffect(() => {
    setLight(document.documentElement.getAttribute('data-theme') !== 'dark');
  }, []);

  function toggle() {
    const next = light ? 'dark' : 'light';
    setLight(next === 'light');
    applyTheme(next);
  }

  const label = light ? 'Przełącz na ciemny motyw' : 'Przełącz na jasny motyw';
  const Icon = light ? Moon : Sun;

  return (
    <button
      onClick={toggle}
      title={label}
      aria-label={label}
      className={cn(
        'flex items-center gap-3 rounded-xl text-sm font-medium text-studio-muted transition-colors hover:bg-studio-bg hover:text-studio-ink',
        withLabel ? 'w-full px-3 py-2.5' : 'p-2',
        className
      )}
    >
      <Icon className="h-4 w-4" />
      {withLabel && (light ? 'Ciemny motyw' : 'Jasny motyw')}
    </button>
  );
}
