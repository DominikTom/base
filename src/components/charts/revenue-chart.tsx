'use client';

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { SHOP_COLORS, formatCompact } from '@/lib/utils';
import { useChartTheme } from '@/lib/chart-theme';

interface RevenueChartProps {
  data: Array<Record<string, string | number>>;
  shops: string[];
  stacked?: boolean;
}

export function RevenueChart({ data, shops, stacked = false }: RevenueChartProps) {
  const chart = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
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
            stroke={SHOP_COLORS[shop] || chart.tickFaint}
            fill={SHOP_COLORS[shop] || chart.tickFaint}
            fillOpacity={stacked ? 0.6 : 0.1}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
