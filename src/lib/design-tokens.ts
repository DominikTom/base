// Design tokens — JEDNO źródło prawdy dla kolorów, radiusów, cieni.
// CSS-owa kopia żyje w src/app/globals.css (@theme inline) — generuje
// klasy Tailwind v4 (bg-bg, bg-surface, text-fg, text-muted, border-line,
// shadow-card, rounded-card). Wartości muszą być identyczne.
//
// TS-owa kopia (ten plik) potrzebna jest dla recharts: stroke=, fill=,
// gradient <stop> — Tailwind do nich nie zajrzy.
//
// Swap primary (np. fiolet → zielony) = jedno miejsce: COLOR_PRIMARY.

export const COLOR_PRIMARY = {
  50:  '#FAF5FF',
  100: '#F3E8FF',
  200: '#E9D5FF',
  300: '#D8B4FE',
  400: '#C084FC',
  500: '#A855F7',
  600: '#9333EA',
  700: '#7E22CE',
  800: '#6B21A8',
  900: '#581C87',
} as const;

export const COLOR_SURFACE = {
  bg:      '#F6F7F5',  // app background — off-white, nie czysta biel
  surface: '#FFFFFF',  // karty
  line:    '#ECEDEB',  // subtelny border
} as const;

export const COLOR_TEXT = {
  fg:     '#0F1310',   // nagłówki — near-black
  fgSoft: '#4A4F4B',   // body
  muted:  '#8B908C',   // captions, uppercase labels
} as const;

export const COLOR_STATUS = {
  success: '#16A34A',  // zielony badge wzrostu
  danger:  '#E11D48',  // czerwony badge spadku
  info:    '#2563EB',
  warning: '#D97706',
} as const;

// Czarny pill akcent (jak na referencjach Nodus/Daxa)
export const COLOR_ACCENT = {
  bg: '#0F1310',
  fg: '#FFFFFF',
} as const;

export const RADIUS = {
  card: '20px',
  pill: '9999px',
} as const;

export const SHADOW = {
  card:      '0 4px 24px rgba(0,0,0,0.04)',
  cardHover: '0 8px 32px rgba(0,0,0,0.06)',
  pop:       '0 12px 40px rgba(0,0,0,0.10)',
} as const;

// ─── Gradienty wykresów ────────────────────────────────────────────
// Stops do recharts <linearGradient> — kolor + opacity od góry do dołu.
// Używać jako: gradientStops.primary.map(s => <stop offset=... stopColor=s.color stopOpacity=s.opacity/>)
export const gradientStops = {
  primary: [
    { offset: '0%',   color: COLOR_PRIMARY[600], opacity: 0.4  },
    { offset: '60%',  color: COLOR_PRIMARY[400], opacity: 0.12 },
    { offset: '100%', color: COLOR_PRIMARY[200], opacity: 0.0  },
  ],
  success: [
    { offset: '0%',   color: '#16A34A', opacity: 0.35 },
    { offset: '60%',  color: '#4ADE80', opacity: 0.10 },
    { offset: '100%', color: '#BBF7D0', opacity: 0.0  },
  ],
  danger: [
    { offset: '0%',   color: '#E11D48', opacity: 0.35 },
    { offset: '60%',  color: '#FB7185', opacity: 0.10 },
    { offset: '100%', color: '#FECDD3', opacity: 0.0  },
  ],
  info: [
    { offset: '0%',   color: '#2563EB', opacity: 0.35 },
    { offset: '60%',  color: '#60A5FA', opacity: 0.10 },
    { offset: '100%', color: '#BFDBFE', opacity: 0.0  },
  ],
} as const;

// Ranking serii — gdy wykres nie ma semantyki sklepu/kategorii (np. „top N").
// Cykl odcieni fioletu od ciemnego do jasnego.
export const seriesPalette = [
  COLOR_PRIMARY[700],
  COLOR_PRIMARY[500],
  COLOR_PRIMARY[400],
  COLOR_PRIMARY[300],
  COLOR_PRIMARY[600],
  COLOR_PRIMARY[800],
  COLOR_PRIMARY[200],
] as const;

// Recharts grid stroke — bardzo jasny, prawie niewidoczny.
export const CHART_GRID_STROKE = '#EAEBE8';
export const CHART_AXIS_TICK = '#8B908C';
