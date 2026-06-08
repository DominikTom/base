'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { SHOP_COLORS, CATEGORY_COLORS, formatCompact } from '@/lib/utils';

interface SimplePieChartProps {
  data: Array<{ name: string; value: number }>;
  colorMap?: 'shop' | 'category' | 'custom';
  customColors?: string[];
  height?: number;
  innerRadius?: number;
  showLegend?: boolean;
}

const DEFAULT_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#f97316', '#06b6d4', '#ec4899', '#84cc16', '#14b8a6',
];

export function SimplePieChart({
  data,
  colorMap = 'custom',
  customColors,
  height = 320,
  innerRadius = 60,
  showLegend = true,
}: SimplePieChartProps) {
  function getColor(name: string, index: number): string {
    if (colorMap === 'shop') return SHOP_COLORS[name] || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
    if (colorMap === 'category') return CATEGORY_COLORS[name] || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
    if (customColors) return customColors[index % customColors.length];
    return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={innerRadius + 50}
          dataKey="value"
          nameKey="name"
          paddingAngle={2}
          strokeWidth={0}
        >
          {data.map((entry, i) => (
            <Cell key={i} fill={getColor(entry.name, i)} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #ECEDEB',
            borderRadius: '8px',
            fontSize: '12px',
          }}
          formatter={(value) => [formatCompact(Number(value)) + ' PLN', '']}
        />
        {showLegend && (
          <Legend
            wrapperStyle={{ fontSize: '12px' }}
            iconType="circle"
            iconSize={8}
            layout="vertical"
            align="right"
            verticalAlign="middle"
          />
        )}
      </PieChart>
    </ResponsiveContainer>
  );
}
