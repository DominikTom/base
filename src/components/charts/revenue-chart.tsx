'use client';

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { SHOP_COLORS, formatCompact } from '@/lib/utils';

interface RevenueChartProps {
  data: Array<Record<string, string | number>>;
  shops: string[];
  stacked?: boolean;
}

export function RevenueChart({ data, shops, stacked = false }: RevenueChartProps) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#EAEBE8" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#8B908C' }}
          tickLine={false}
          axisLine={{ stroke: '#3f3f46' }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#8B908C' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatCompact}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #ECEDEB',
            borderRadius: '8px',
            fontSize: '12px',
          }}
          labelStyle={{ color: '#a1a1aa' }}
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
            stroke={SHOP_COLORS[shop] || '#6b7280'}
            fill={SHOP_COLORS[shop] || '#6b7280'}
            fillOpacity={stacked ? 0.6 : 0.1}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
