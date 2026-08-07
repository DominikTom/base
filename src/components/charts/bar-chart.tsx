'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useId } from 'react';
import { formatCompact, CATEGORY_COLORS } from '@/lib/utils';
import { useChartTheme, CHART_PRIMARY } from '@/lib/chart-theme';

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
  barColor = CHART_PRIMARY,
  valueFormatter = formatCompact
}: SimpleBarChartProps) {
  const chart = useChartTheme();
  // Unikatowy prefix dla <linearGradient id> — ID musi być unikalne per chart.
  const uid = useId().replace(/:/g, '');

  const cellColor = (entry: { name: string; color?: string }) =>
    colorByName ? (CATEGORY_COLORS[entry.name] || entry.color || barColor) : (entry.color || barColor);

  // „Opadający" gradient: pełny kolor u nasady wartości, rozjaśnienie przez
  // opacity ku końcowi — działa w light i dark bez mieszania z bielą.
  const uniqueColors = [...new Set(data.map(cellColor))];
  const gradientId = (color: string) => `bar-grad-${uid}-${color.replace('#', '')}`;
  const gradDef = (color: string, isHorizontal: boolean) => (
    <linearGradient
      key={color}
      id={gradientId(color)}
      x1="0"
      y1="0"
      x2={isHorizontal ? '1' : '0'}
      y2={isHorizontal ? '0' : '1'}
    >
      <stop offset="0%" stopColor={color} stopOpacity={1} />
      <stop offset="100%" stopColor={color} stopOpacity={0.35} />
    </linearGradient>
  );

  if (layout === 'horizontal') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 100 }}>
          <defs>{uniqueColors.map(c => gradDef(c, true))}</defs>
          <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: chart.tickFaint }}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatCompact}
          />
          <YAxis
            dataKey="name"
            type="category"
            tick={{ fontSize: 11, fill: chart.tick }}
            tickLine={false}
            axisLine={false}
            width={90}
          />
          <Tooltip
            contentStyle={chart.tooltip}
            labelStyle={chart.tooltipLabel}
            formatter={(value) => [valueFormatter(Number(value)), '']}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={24}>
            {data.map((entry, i) => (
              <Cell key={i} fill={`url(#${gradientId(cellColor(entry))})`} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <defs>{uniqueColors.map(c => gradDef(c, false))}</defs>
        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
        <XAxis
          dataKey="name"
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
          formatter={(value) => [valueFormatter(Number(value)), '']}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40}>
          {data.map((entry, i) => (
            <Cell key={i} fill={`url(#${gradientId(cellColor(entry))})`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
