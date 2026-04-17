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
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { LogOut } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/dashboard/my', label: 'Mój Dashboard', icon: PanelTop, adminOnly: false },
  { href: '/dashboard/overview', label: 'Przegląd', icon: LayoutDashboard, adminOnly: false },
  { href: '/dashboard/revenue', label: 'Revenue & Zamówienia', icon: TrendingUp, adminOnly: false },
  { href: '/dashboard/marketing', label: 'Marketing', icon: Megaphone, adminOnly: false },
  { href: '/dashboard/costs', label: 'Koszty agencji', icon: Wallet, adminOnly: true },
  { href: '/dashboard/products', label: 'Produkty', icon: ShoppingBag, adminOnly: false },
  { href: '/dashboard/traffic', label: 'Ruch (GA4)', icon: Globe, adminOnly: false },
  { href: '/dashboard/explorer', label: 'Eksplorator', icon: Compass, adminOnly: false },
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
      'fixed top-0 left-0 h-screen bg-zinc-950 border-r border-zinc-800 flex flex-col transition-all duration-200 z-40',
      collapsed ? 'w-16' : 'w-60'
    )}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-zinc-800 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
          MB
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-zinc-100">MyBed Group</span>
            <span className="text-xs text-zinc-500">Data Dashboard</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {visibleItems.map(item => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                active
                  ? 'bg-blue-600/15 text-blue-400 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              )}
            >
              <item.icon size={20} className="shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User info + logout */}
      {!collapsed && userEmail && (
        <div className="px-3 py-2 border-t border-zinc-800">
          <div className="text-xs text-zinc-500 truncate">{userEmail}</div>
          <div className="text-xs text-zinc-600">{userRole}</div>
        </div>
      )}
      <div className="flex border-t border-zinc-800">
        <button
          onClick={handleLogout}
          className="flex-1 flex items-center justify-center gap-2 h-12 text-zinc-500 hover:text-red-400 transition-colors text-sm"
        >
          <LogOut size={16} />
          {!collapsed && 'Wyloguj'}
        </button>
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex items-center justify-center w-12 h-12 text-zinc-500 hover:text-zinc-300 transition-colors border-l border-zinc-800"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
    </aside>
  );
}
