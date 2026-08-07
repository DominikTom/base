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
import { LogoMark } from '@/components/ui/logo-mark';
import { Avatar } from '@/components/ui/avatar';

const NAV_SECTIONS = [
  {
    label: 'Start',
    items: [
      { href: '/dashboard/my', label: 'Mój Dashboard', icon: PanelTop, adminOnly: false },
      { href: '/dashboard/chat', label: 'Asystent AI', icon: Sparkles, adminOnly: false },
      { href: '/dashboard/kpi', label: 'KPI', icon: Target, adminOnly: false },
      { href: '/dashboard/overview', label: 'Przegląd', icon: LayoutDashboard, adminOnly: false },
    ],
  },
  {
    label: 'Analityka',
    items: [
      { href: '/dashboard/revenue', label: 'Revenue & Zamówienia', icon: TrendingUp, adminOnly: false },
      { href: '/dashboard/marketing', label: 'Marketing', icon: Megaphone, adminOnly: false },
      { href: '/dashboard/costs', label: 'Koszty agencji', icon: Wallet, adminOnly: true },
      { href: '/dashboard/products', label: 'Produkty', icon: ShoppingBag, adminOnly: false },
      { href: '/dashboard/traffic', label: 'Ruch (GA4)', icon: Globe, adminOnly: false },
      { href: '/dashboard/weather', label: 'Pogoda × Sprzedaż', icon: CloudSun, adminOnly: false },
      { href: '/dashboard/showroomy', label: 'Showroomy', icon: BarChart3, adminOnly: false },
    ],
  },
  {
    label: 'Dane',
    items: [
      { href: '/dashboard/explorer', label: 'Eksplorator', icon: Compass, adminOnly: false },
      { href: '/dashboard/database', label: 'Baza danych', icon: Database, adminOnly: true },
      { href: '/dashboard/admin', label: 'ETL Admin', icon: Settings, adminOnly: true },
    ],
  },
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

  const visibleSections = NAV_SECTIONS
    .map(section => ({
      ...section,
      items: section.items.filter(item => !item.adminOnly || userRole === 'admin'),
    }))
    .filter(section => section.items.length > 0);

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
      <div className="flex items-center gap-3 px-4 h-14 border-b border-line shrink-0">
        <LogoMark size={28} className="shrink-0" />
        {!collapsed && (
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-ink">MyBed Group</span>
            <span className="font-mono text-[11px] text-ink-faint">Data Dashboard</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto">
        {visibleSections.map((section, si) => (
          <div key={section.label}>
            {!collapsed && (
              <div className={cn('px-2.5 pb-1 text-xs font-medium text-ink-faint', si === 0 ? 'pt-1' : 'pt-4')}>
                {section.label}
              </div>
            )}
            {collapsed && si > 0 && <div className="mx-2 my-2 border-t border-line" />}
            <div className="space-y-0.5">
              {section.items.map(item => {
                const active = pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'nav-link min-h-[30px]',
                      active && 'nav-link-active',
                      collapsed && 'justify-center px-0'
                    )}
                  >
                    <item.icon size={17} className="shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User info + logout */}
      {userEmail && (
        <div className={cn('border-t border-line px-2 py-2', collapsed && 'flex justify-center')}>
          <div className={cn('flex items-center gap-2.5 rounded-lg px-2 py-1.5', collapsed && 'px-0')}>
            <Avatar name={userEmail} size={28} />
            {!collapsed && (
              <div className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-xs font-medium text-ink">{userEmail}</span>
                <span className="text-[11px] text-ink-faint">{userRole}</span>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="flex border-t border-line">
        <button
          onClick={handleLogout}
          className="flex-1 flex items-center justify-center gap-2 h-11 text-[13px] font-medium text-ink-muted hover:text-red-600 hover:bg-surface-2 transition-colors"
        >
          <LogOut size={15} />
          {!collapsed && 'Wyloguj'}
        </button>
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex items-center justify-center w-11 h-11 text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors border-l border-line"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </aside>
  );
}
