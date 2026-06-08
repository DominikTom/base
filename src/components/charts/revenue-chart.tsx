'use client';

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { SHOP_COLORS, formatCompact } from '@/lib/utils';

interface RevenueChartProps {
  data: Array<Record<string, string | number>>;
  shops: string[];
  stacked?: boolean;
}

export function RevenueChart({ data, shops, stacked = false }: RevenueChartProps) {
  // Gradient „opadający": top mocniejszy, dół zanikający.
  const gradId = (shop: string) => `rev-grad-${shop.replace(/\./g, '-')}`;
  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <defs>
          {shops.map(shop => {
            const c = SHOP_COLORS[shop] || '#6b7280';
            return (
              <linearGradient key={shop} id={gradId(shop)} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c} stopOpacity={stacked ? 0.9 : 0.55} />
                <stop offset="100%" stopColor={c} stopOpacity={stacked ? 0.15 : 0.02} />
              </linearGradient>
            );
          })}
        </defs>
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
            fill={`url(#${gradId(shop)})`}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
