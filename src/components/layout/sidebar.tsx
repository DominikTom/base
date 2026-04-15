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
} from 'lucide-react';
import { useState } from 'react';

const NAV_ITEMS = [
  { href: '/dashboard/overview', label: 'Przegląd', icon: LayoutDashboard },
  { href: '/dashboard/revenue', label: 'Revenue & Zamówienia', icon: TrendingUp },
  { href: '/dashboard/marketing', label: 'Marketing', icon: Megaphone },
  { href: '/dashboard/products', label: 'Produkty', icon: ShoppingBag },
  { href: '/dashboard/traffic', label: 'Ruch (GA4)', icon: Globe },
  { href: '/dashboard/explorer', label: 'Eksplorator', icon: Compass },
  { href: '/dashboard/admin', label: 'ETL Admin', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

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
        {NAV_ITEMS.map(item => {
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

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center justify-center h-12 border-t border-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
      </button>
    </aside>
  );
}
