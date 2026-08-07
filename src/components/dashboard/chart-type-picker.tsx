'use client';

// Wybór typu wykresu z miniaturkami. Używany w modalu "Nowy KPI".
// Miniaturki to małe SVG (kolor dziedziczony przez currentColor).

const CHART_TYPES = [
  { value: 'bar', label: 'Słupkowy' },
  { value: 'line', label: 'Liniowy' },
  { value: 'area', label: 'Warstwowy' },
  { value: 'pie', label: 'Kołowy' },
  { value: 'table', label: 'Tabela' },
  { value: 'pivot', label: 'Pivot' },
];

function Thumb({ type }: { type: string }) {
  const common = { width: 44, height: 26, viewBox: '0 0 44 26' };
  switch (type) {
    case 'line':
      return (
        <svg {...common}>
          <polyline points="3,20 14,9 25,15 41,4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'area':
      return (
        <svg {...common}>
          <path d="M3 22 L3 16 L16 8 L28 14 L41 5 L41 22 Z" fill="currentColor" fillOpacity={0.55} />
          <polyline points="3,16 16,8 28,14 41,5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'pie':
      return (
        <svg {...common}>
          <circle cx={22} cy={13} r={11} fill="currentColor" fillOpacity={0.3} />
          <path d="M22 13 L22 2 A11 11 0 0 1 31.5 18.5 Z" fill="currentColor" />
        </svg>
      );
    case 'table':
      return (
        <svg {...common}>
          <rect x={4} y={4} width={36} height={18} rx={1.5} fill="none" stroke="currentColor" strokeWidth={1.6} />
          <line x1={4} y1={10} x2={40} y2={10} stroke="currentColor" strokeWidth={1.6} />
          <line x1={16} y1={4} x2={16} y2={22} stroke="currentColor" strokeWidth={1.6} />
          <line x1={28} y1={4} x2={28} y2={22} stroke="currentColor" strokeWidth={1.6} />
        </svg>
      );
    case 'pivot':
      return (
        <svg {...common}>
          <rect x={4} y={4} width={36} height={18} rx={1.5} fill="none" stroke="currentColor" strokeWidth={1.6} />
          <line x1={4} y1={10} x2={40} y2={10} stroke="currentColor" strokeWidth={1.6} />
          <line x1={14} y1={4} x2={14} y2={22} stroke="currentColor" strokeWidth={1.6} />
          <line x1={4} y1={16} x2={40} y2={16} stroke="currentColor" strokeWidth={1.2} strokeDasharray="2 2" />
          <text x={20} y={14.5} fontSize={5.5} fill="currentColor" fontWeight={700}>Σ fx</text>
        </svg>
      );
    case 'bar':
    default:
      return (
        <svg {...common}>
          <rect x={4} y={14} width={6} height={12} rx={1} fill="currentColor" />
          <rect x={14} y={7} width={6} height={19} rx={1} fill="currentColor" />
          <rect x={24} y={17} width={6} height={9} rx={1} fill="currentColor" />
          <rect x={34} y={3} width={6} height={23} rx={1} fill="currentColor" />
        </svg>
      );
  }
}

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function ChartTypePicker({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {CHART_TYPES.map(t => {
        const active = value === t.value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 transition-colors ${
              active
                ? 'border-primary/50 bg-primary/10 text-primary-ink'
                : 'border-line bg-surface text-ink-muted hover:bg-surface-2 hover:text-ink-soft'
            }`}
          >
            <Thumb type={t.value} />
            <span className="text-[11px] font-medium">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
