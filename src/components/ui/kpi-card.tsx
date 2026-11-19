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

function MiniSparkline({ data }: { data: number[] }) {
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
    <svg width={w} height={h} className="ml-auto text-primary opacity-50">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        points={points}
      />
    </svg>
  );
}

// Płaski kafel KPI: label + liczba (Geist Mono, kolor ink). Bez ikon
// i akcentowych kolorów liczb — status niosą wyłącznie delty.
export function KpiCard({ title, value, change, changeLabel, subLabel, sparkline, className }: KpiCardProps) {
  const isPositive = (change ?? 0) >= 0;
  const isNeutral = change === null || change === undefined;

  return (
    <div className={cn('card p-4 flex flex-col gap-1.5', className)}>
      <span className="stat-label">{title}</span>
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="font-mono text-2xl font-semibold tracking-tight text-ink">{value}</div>
          {subLabel && (
            <div className="text-xs text-ink-faint mt-0.5">{subLabel}</div>
          )}
          {!isNeutral && (
            <div className={cn(
              'flex items-center gap-1 text-[13px] mt-1',
              isPositive ? 'text-emerald-600' : 'text-red-600'
            )}>
              {isPositive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
              <span className="font-mono">{change! >= 0 ? '+' : ''}{change!.toFixed(1)}%</span>
              {changeLabel && <span className="text-ink-faint ml-1 font-sans">{changeLabel}</span>}
            </div>
          )}
          {isNeutral && changeLabel && (
            <div className="flex items-center gap-1 text-[13px] mt-1 text-ink-faint">
              <Minus size={13} />
              <span>{changeLabel}</span>
            </div>
          )}
        </div>
        {sparkline && sparkline.length > 1 && (
          <MiniSparkline data={sparkline} />
        )}
      </div>
    </div>
  );
}
