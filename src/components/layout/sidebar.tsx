'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  TrendingUp,
  ShoppingBag,
  Megaphone,
  BarChart3,
  Globe,
  Compass,
  Settings,
  ChevronLeft,
  ChevronRight,
  PanelTop,
  Wallet,
  Database,
  Sparkles,
  Target,
  CloudSun,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { LogOut } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/dashboard/my', label: 'Mój Dashboard', icon: PanelTop, adminOnly: false },
  { href: '/dashboard/chat', label: 'Asystent AI', icon: Sparkles, adminOnly: false },
  { href: '/dashboard/kpi', label: 'KPI', icon: Target, adminOnly: false },
  { href: '/dashboard/overview', label: 'Przegląd', icon: LayoutDashboard, adminOnly: false },
  { href: '/dashboard/revenue', label: 'Revenue & Zamówienia', icon: TrendingUp, adminOnly: false },
  { href: '/dashboard/marketing', label: 'Marketing', icon: Megaphone, adminOnly: false },
  { href: '/dashboard/costs', label: 'Koszty agencji', icon: Wallet, adminOnly: true },
  { href: '/dashboard/products', label: 'Produkty', icon: ShoppingBag, adminOnly: false },
  { href: '/dashboard/traffic', label: 'Ruch (GA4)', icon: Globe, adminOnly: false },
  { href: '/dashboard/weather', label: 'Pogoda × Sprzedaż', icon: CloudSun, adminOnly: false },
  { href: '/dashboard/showroomy', label: 'Showroomy', icon: BarChart3, adminOnly: false },
  { href: '/dashboard/explorer', label: 'Eksplorator', icon: Compass, adminOnly: false },
  { href: '/dashboard/database', label: 'Baza danych', icon: Database, adminOnly: true },
  { href: '/dashboard/admin', label: 'ETL Admin', icon: Settings, adminOnly: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [userRole, setUserRole] = useState<string>('admin'); // default admin until loaded
  const [userEmail, setUserEmail] = useState<string>('');

  useEffect(() => {
    fetch('/api/user').then(r => r.json()).then(data => {
      setUserRole(data.profile?.role || 'viewer');
      setUserEmail(data.user?.email || '');
    }).catch(() => {});
  }, []);

  const visibleItems = NAV_ITEMS.filter(item => !item.adminOnly || userRole === 'admin');

  async function handleLogout() {
    const { createBrowserClient } = await import('@supabase/ssr');
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  return (
    <aside className={cn(
      'fixed top-0 left-0 h-screen bg-surface border-r border-line flex flex-col transition-all duration-200 z-40',
      collapsed ? 'w-16' : 'w-60'
    )}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-line shrink-0">
        <div className="w-9 h-9 rounded-xl bg-accent-bg flex items-center justify-center text-accent-fg font-bold text-sm">
          MB
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-fg">MyBed Group</span>
            <span className="text-[11px] text-muted">Data Dashboard</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-0.5 overflow-y-auto">
        {visibleItems.map(item => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors',
                active
                  ? 'bg-primary-100 text-primary-700 font-medium'
                  : 'text-fg-soft hover:text-fg hover:bg-bg'
              )}
            >
              <item.icon size={18} className="shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User info + logout */}
      {!collapsed && userEmail && (
        <div className="px-4 py-2 border-t border-line">
          <div className="text-xs text-fg-soft truncate font-medium">{userEmail}</div>
          <div className="text-[11px] text-muted">{userRole}</div>
        </div>
      )}
      <div className="flex border-t border-line">
        <button
          onClick={handleLogout}
          className="flex-1 flex items-center justify-center gap-2 h-12 text-muted hover:text-danger transition-colors text-sm"
        >
          <LogOut size={16} />
          {!collapsed && 'Wyloguj'}
        </button>
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex items-center justify-center w-12 h-12 text-muted hover:text-fg transition-colors border-l border-line"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
    </aside>
  );
}
