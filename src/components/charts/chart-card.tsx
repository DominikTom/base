'use client';

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}

export function ChartCard({ title, subtitle, children, className, action }: ChartCardProps) {
  return (
    <div className={cn('card p-4 flex flex-col', className)}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="section-title">{title}</h3>
          {subtitle && <p className="text-xs text-ink-faint mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="flex-1 min-h-0">
        {children}
      </div>
    </div>
  );
}
