'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatCompact, CATEGORY_COLORS } from '@/lib/utils';
import { useId } from 'react';

interface SimpleBarChartProps {
  data: Array<{ name: string; value: number; color?: string }>;
  layout?: 'vertical' | 'horizontal';
  height?: number;
  colorByName?: boolean;
  barColor?: string;
  valueFormatter?: (v: number) => string;
}

// Lighten hex color by mixing with white. Używamy do "spadającego" gradientu
// — top = solid color, bottom = lighter shade (~55% mieszanie z białym).
function lighten(hex: string, amount: number): string {
  const m = hex.replace('#', '').match(/.{1,2}/g);
  if (!m || m.length < 3) return hex;
  const [r, g, b] = m.map(c => parseInt(c, 16));
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[mix(r), mix(g), mix(b)].map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

export function SimpleBarChart({
  data,
  layout = 'vertical',
  height = 320,
  colorByName = false,
  barColor = '#9333EA',
  valueFormatter = formatCompact
}: SimpleBarChartProps) {
  // Unikatowy prefix dla `<linearGradient id>` — recharts wymaga ID per chart.
  const uid = useId().replace(/:/g, '');

  // Zbuduj unique color set żeby zdefiniować po jednym gradientcie per kolor.
  const uniqueColors = new Set<string>();
  data.forEach(entry => {
    const c = colorByName ? (CATEGORY_COLORS[entry.name] || entry.color || barColor) : (entry.color || barColor);
    uniqueColors.add(c);
  });
  const gradientId = (color: string) => `bar-grad-${uid}-${color.replace('#', '')}`;

  // Bary horizontalne: gradient idzie z LEWA (mocniejszy) na PRAWO (jaśniejszy)
  // żeby zachować efekt „opadającej" intensywności wzdłuż osi wartości.
  // Bary pionowe: top → bottom (klasyk).
  const gradDef = (color: string, isHorizontal: boolean) => (
    <linearGradient
      key={color}
      id={gradientId(color)}
      x1={isHorizontal ? '0' : '0'}
      y1={isHorizontal ? '0' : '0'}
      x2={isHorizontal ? '1' : '0'}
      y2={isHorizontal ? '0' : '1'}
    >
      <stop offset="0%" stopColor={color} stopOpacity={1} />
      <stop offset="100%" stopColor={lighten(color, 0.55)} stopOpacity={1} />
    </linearGradient>
  );

  if (layout === 'horizontal') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 100 }}>
          <defs>{[...uniqueColors].map(c => gradDef(c, true))}</defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#EAEBE8" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11, fill: '#8B908C' }}
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
              backgroundColor: '#FFFFFF',
              border: '1px solid #ECEDEB',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            formatter={(value) => [valueFormatter(Number(value)), '']}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={24}>
            {data.map((entry, i) => {
              const c = colorByName ? (CATEGORY_COLORS[entry.name] || entry.color || barColor) : (entry.color || barColor);
              return <Cell key={i} fill={`url(#${gradientId(c)})`} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <defs>{[...uniqueColors].map(c => gradDef(c, false))}</defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#EAEBE8" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: '#8B908C' }}
          tickLine={false}
          axisLine={{ stroke: '#ECEDEB' }}
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
          formatter={(value) => [valueFormatter(Number(value)), '']}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={40}>
          {data.map((entry, i) => {
            const c = colorByName ? (CATEGORY_COLORS[entry.name] || entry.color || barColor) : (entry.color || barColor);
            return <Cell key={i} fill={`url(#${gradientId(c)})`} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
