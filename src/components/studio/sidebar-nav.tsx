'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { Lightbulb, Library, LogOut, Sparkles, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/studio/new', label: 'Nowa wizualizacja', icon: Sparkles },
  { href: '/studio/library', label: 'Biblioteka', icon: Library },
  { href: '/studio/inspirations', label: 'Inspiracje', icon: Lightbulb },
  { href: '/studio/trash', label: 'Kosz', icon: Trash2 },
];

export function StudioSidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-studio-border bg-studio-surface">
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-studio-ink text-sm font-bold text-white">
          MB
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight text-studio-ink">MyBed</p>
          <p className="text-xs text-studio-muted">Visual Studio</p>
        </div>
      </div>

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

      <div className="border-t border-studio-border p-3">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-studio-muted transition-colors hover:bg-studio-bg hover:text-studio-ink"
        >
          <LogOut className="h-4 w-4" />
          Wyloguj
        </button>
      </div>
    </aside>
  );
}
