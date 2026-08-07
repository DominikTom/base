'use client';

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useId } from 'react';
import { SHOP_COLORS, formatCompact } from '@/lib/utils';
import { useChartTheme } from '@/lib/chart-theme';

interface RevenueChartProps {
  data: Array<Record<string, string | number>>;
  shops: string[];
  stacked?: boolean;
}

export function RevenueChart({ data, shops, stacked = false }: RevenueChartProps) {
  const chart = useChartTheme();
  // Unikatowy prefix dla <linearGradient id> — ID musi być unikalne per chart.
  const uid = useId().replace(/:/g, '');

  const shopColor = (shop: string) => SHOP_COLORS[shop] || chart.tickFaint;
  const gradientId = (shop: string) => `rev-grad-${uid}-${shop.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <defs>
          {/* „Opadający" gradient wypełnienia — pełniejszy przy linii, zanika ku osi */}
          {shops.map(shop => (
            <linearGradient key={shop} id={gradientId(shop)} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={shopColor(shop)} stopOpacity={stacked ? 0.55 : 0.28} />
              <stop offset="100%" stopColor={shopColor(shop)} stopOpacity={stacked ? 0.12 : 0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: chart.tickFaint }}
          tickLine={false}
          axisLine={{ stroke: chart.axis }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: chart.tickFaint }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatCompact}
        />
        <Tooltip
          contentStyle={chart.tooltip}
          labelStyle={chart.tooltipLabel}
          formatter={(value) => [new Intl.NumberFormat('pl-PL').format(Number(value)) + ' PLN', '']}
        />
        <Legend
          wrapperStyle={{ fontSize: '12px' }}
          iconType="circle"
          iconSize={8}
        />
        {shops.map((shop) => (
          <Area
            key={shop}
            type="monotone"
            dataKey={shop}
            name={shop}
            stackId={stacked ? 'stack' : undefined}
            stroke={shopColor(shop)}
            fill={`url(#${gradientId(shop)})`}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
