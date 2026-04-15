'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import { formatCompact, CATEGORY_COLORS } from '@/lib/utils';

interface SimpleBarChartProps {
  data: Array<{ name: string; value: number; color?: string }>;
  layout?: 'vertical' | 'horizontal';
  height?: number;
  colorByName?: boolean;
  barColor?: string;
  valueFormatter?: (v: number) => string;
}

export function SimpleBarChart({
  data,
  layout = 'vertical',
  height = 320,
  colorByName = false,
  barColor = '#3b82f6',
  valueFormatter = formatCompact
}: SimpleBarChartProps) {
  if (layout === 'horizontal') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 100 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: '#71717a' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatCompact}
          />
          <YAxis
            dataKey="name"
            type="category"
            tick={{ fontSize: 11, fill: '#a1a1aa' }}
            tickLine={false}
            axisLine={false}
            width={90}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#18181b',
              border: '1px solid #3f3f46',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            formatter={(value) => [valueFormatter(Number(value)), '']}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={24}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={colorByName ? (CATEGORY_COLORS[entry.name] || entry.color || barColor) : (entry.color || barColor)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: '#71717a' }}
          tickLine={false}
          axisLine={{ stroke: '#3f3f46' }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#71717a' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatCompact}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#18181b',
            border: '1px solid #3f3f46',
            borderRadius: '8px',
            fontSize: '12px',
          }}
          formatter={(value) => [valueFormatter(Number(value)), '']}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={colorByName ? (CATEGORY_COLORS[entry.name] || entry.color || barColor) : (entry.color || barColor)}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
