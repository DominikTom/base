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
      'rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 flex flex-col gap-2',
      className
    )}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-400">{title}</span>
        {icon && <span className="text-zinc-500">{icon}</span>}
      </div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-2xl font-bold text-zinc-100">{value}</div>
          {subLabel && (
            <div className="text-xs text-zinc-500 mt-0.5">{subLabel}</div>
          )}
          {!isNeutral && (
            <div className={cn(
              'flex items-center gap-1 text-sm mt-1',
              isPositive ? 'text-emerald-400' : 'text-red-400'
            )}>
              {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              <span>{change! >= 0 ? '+' : ''}{change!.toFixed(1)}%</span>
              {changeLabel && <span className="text-zinc-500 ml-1">{changeLabel}</span>}
            </div>
          )}
          {isNeutral && changeLabel && (
            <div className="flex items-center gap-1 text-sm mt-1 text-zinc-500">
              <Minus size={14} />
              <span>{changeLabel}</span>
            </div>
          )}
        </div>
        {sparkline && sparkline.length > 1 && (
          <MiniSparkline data={sparkline} positive={isPositive} />
        )}
      </div>
    </div>
  );
}
