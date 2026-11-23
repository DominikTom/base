'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { Images, Lightbulb, Library, LogOut, Menu, Sparkles, Trash2, X } from 'lucide-react';
import { ThemeToggle } from '@/components/studio/theme-toggle';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/studio/new', label: 'Nowa wizualizacja', icon: Sparkles },
  { href: '/studio/library', label: 'Biblioteka', icon: Library },
  { href: '/studio/packshots', label: 'Packshoty', icon: Images },
  { href: '/studio/inspirations', label: 'Inspiracje', icon: Lightbulb },
  { href: '/studio/trash', label: 'Kosz', icon: Trash2 },
];

export function StudioSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Zamknij szufladę przy zmianie trasy.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  async function handleLogout() {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    await supabase.auth.signOut();
    router.push('/login');
  }

  const nav = (
    <nav className="flex-1 space-y-1 px-3">
      {NAV_ITEMS.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
              active
                ? 'bg-studio-accent-soft text-studio-accent-dark'
                : 'text-studio-muted hover:bg-studio-bg hover:text-studio-ink'
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const logoutButton = (
    <div className="space-y-1 border-t border-studio-border p-3">
      <ThemeToggle withLabel />
      <button
        onClick={handleLogout}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-studio-muted transition-colors hover:bg-studio-bg hover:text-studio-ink"
      >
        <LogOut className="h-4 w-4" />
        Wyloguj
      </button>
    </div>
  );

  const logo = (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-studio-ink text-sm font-bold text-white md:h-10 md:w-10">
        MB
      </div>
      <div>
        <p className="text-sm font-semibold leading-tight text-studio-ink">MyBed</p>
        <p className="text-xs text-studio-muted">Visual Studio</p>
      </div>
    </div>
  );

  return (
    <>
      {/* Pasek górny — tylko mobile */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between border-b border-studio-border bg-studio-surface px-4 py-2.5 md:hidden"
        style={{ paddingTop: 'calc(0.625rem + env(safe-area-inset-top, 0px))' }}
      >
        {logo}
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            onClick={() => setDrawerOpen(true)}
            className="rounded-xl p-2 text-studio-muted transition-colors hover:bg-studio-bg hover:text-studio-ink"
            aria-label="Otwórz menu"
          >
            <Menu className="h-6 w-6" />
          </button>
        </div>
      </header>

      {/* Szuflada — mobile */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <div
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-studio-surface shadow-xl"
            style={{
              paddingTop: 'env(safe-area-inset-top, 0px)',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
          >
            <div className="flex items-center justify-between px-6 py-5">
              {logo}
              <button
                onClick={() => setDrawerOpen(false)}
                className="rounded-xl p-2 text-studio-muted hover:text-studio-ink"
                aria-label="Zamknij menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
            {logoutButton}
          </div>
        </div>
      )}

      {/* Sidebar — desktop */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-studio-border bg-studio-surface md:flex">
        <div className="px-6 py-6">{logo}</div>
        {nav}
        {logoutButton}
      </aside>
    </>
  );
}
