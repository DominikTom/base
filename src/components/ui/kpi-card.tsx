'use client';

import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: string;
  change?: number | null;
  changeLabel?: string;
  subLabel?: string;
  icon?: React.ReactNode;
  sparkline?: number[];
  className?: string;
}

function MiniSparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (!data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 80;
  const h = 32;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={w} height={h} className="ml-auto opacity-60">
      <polyline
        fill="none"
        stroke={positive ? '#10b981' : '#ef4444'}
        strokeWidth="2"
        points={points}
      />
    </svg>
  );
}

export function KpiCard({ title, value, change, changeLabel, subLabel, icon, sparkline, className }: KpiCardProps) {
  const isPositive = (change ?? 0) >= 0;
  const isNeutral = change === null || change === undefined;

  return (
    <div className={cn(
      'rounded-card border border-line bg-surface p-6 flex flex-col gap-3 shadow-card hover:shadow-card-hover transition-shadow',
      className
    )}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted uppercase tracking-wider">{title}</span>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-3xl font-bold text-fg tracking-tight">{value}</div>
          {subLabel && (
            <div className="text-xs text-muted mt-1">{subLabel}</div>
          )}
          {!isNeutral && (
            <span className={cn(
              'inline-flex items-center gap-1 text-xs font-semibold mt-2 px-2 py-0.5 rounded-pill',
              isPositive ? 'bg-green-100 text-success' : 'bg-rose-100 text-danger'
            )}>
              {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              <span>{change! >= 0 ? '+' : ''}{change!.toFixed(1)}%</span>
              {changeLabel && <span className="ml-1 opacity-75">{changeLabel}</span>}
            </span>
          )}
          {isNeutral && changeLabel && (
            <span className="inline-flex items-center gap-1 text-xs mt-2 text-muted">
              <Minus size={12} />
              <span>{changeLabel}</span>
            </span>
          )}
        </div>
        {sparkline && sparkline.length > 1 && (
          <MiniSparkline data={sparkline} positive={isPositive} />
        )}
      </div>
    </div>
  );
}
