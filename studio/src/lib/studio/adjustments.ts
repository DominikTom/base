/**
 * Korekty obrazu (zakładka Edycja → Korekty): podstawowe suwaki w stylu
 * Photoshopa + filtry. Ta sama matematyka napędza podgląd na żywo (CSS)
 * i finalny render do PNG (canvas), więc wynik = dokładnie to, co widać.
 */

export interface AdjustmentSettings {
  /** -50…50 (%) */
  brightness: number;
  /** -50…50 (%) */
  contrast: number;
  /** -50…50 (%) */
  saturation: number;
  /** -50 (zimno) … 50 (ciepło) */
  temperature: number;
  /** 0…100 — przyciemnienie rogów */
  vignette: number;
  /** czarno-biały */
  grayscale: boolean;
}

export const DEFAULT_ADJUSTMENTS: AdjustmentSettings = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  vignette: 0,
  grayscale: false,
};

export function isDefaultAdjustments(s: AdjustmentSettings): boolean {
  return (
    s.brightness === 0 &&
    s.contrast === 0 &&
    s.saturation === 0 &&
    s.temperature === 0 &&
    s.vignette === 0 &&
    !s.grayscale
  );
}

/** Wbudowane filtry — nazwane zestawy suwaków (jak presety w Lightroomie). */
export const BUILTIN_FILTERS: { id: string; name: string; settings: AdjustmentSettings }[] = [
  { id: 'original', name: 'Oryginał', settings: { ...DEFAULT_ADJUSTMENTS } },
  {
    id: 'warm-interior',
    name: 'Ciepłe wnętrze',
    settings: { brightness: 4, contrast: 4, saturation: 6, temperature: 22, vignette: 10, grayscale: false },
  },
  {
    id: 'cool-morning',
    name: 'Chłodny poranek',
    settings: { brightness: 6, contrast: 2, saturation: -6, temperature: -20, vignette: 0, grayscale: false },
  },
  {
    id: 'editorial',
    name: 'Kontrast editorial',
    settings: { brightness: 0, contrast: 16, saturation: 4, temperature: 0, vignette: 18, grayscale: false },
  },
  {
    id: 'soft-matte',
    name: 'Mat / soft',
    settings: { brightness: 8, contrast: -12, saturation: -8, temperature: 6, vignette: 0, grayscale: false },
  },
  {
    id: 'golden-hour',
    name: 'Złota godzina',
    settings: { brightness: 2, contrast: 6, saturation: 10, temperature: 34, vignette: 16, grayscale: false },
  },
  {
    id: 'bw',
    name: 'Czarno-biały',
    settings: { brightness: 2, contrast: 10, saturation: 0, temperature: 0, vignette: 14, grayscale: true },
  },
];

/** Łańcuch filtrów CSS/canvas wspólny dla podglądu i renderu. */
export function cssFilterFor(s: AdjustmentSettings): string {
  const parts = [
    `brightness(${(100 + s.brightness) / 100})`,
    `contrast(${(100 + s.contrast) / 100})`,
    `saturate(${(100 + s.saturation) / 100})`,
  ];
  if (s.grayscale) parts.push('grayscale(1)');
  return parts.join(' ');
}

/** Kolor tintu temperatury (nakładany w trybie soft-light / overlay). */
export function temperatureTint(s: AdjustmentSettings): { color: string; alpha: number } | null {
  if (s.temperature === 0) return null;
  const t = Math.abs(s.temperature) / 50; // 0…1
  return s.temperature > 0
    ? { color: 'rgb(255, 138, 36)', alpha: 0.38 * t }
    : { color: 'rgb(42, 110, 255)', alpha: 0.34 * t };
}

/**
 * Render finalny: pełna rozdzielczość źródła, filtr + tint temperatury
 * (soft-light z fallbackiem) + winieta (radialny gradient).
 */
export function renderAdjustedCanvas(
  img: HTMLImageElement,
  s: AdjustmentSettings
): HTMLCanvasElement {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.filter = cssFilterFor(s);
  ctx.drawImage(img, 0, 0, w, h);
  ctx.filter = 'none';

  const tint = temperatureTint(s);
  if (tint) {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = tint.alpha;
    ctx.fillStyle = tint.color;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  if (s.vignette > 0) {
    const strength = s.vignette / 100; // 0…1
    const grad = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.45,
      w / 2,
      h / 2,
      Math.hypot(w, h) / 2
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${0.55 * strength})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  return canvas;
}

/** Krótki, czytelny opis ustawień — do edit_instruction nowej wersji. */
export function describeAdjustments(s: AdjustmentSettings): string {
  const parts: string[] = [];
  const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);
  if (s.brightness !== 0) parts.push(`jasność ${signed(s.brightness)}`);
  if (s.contrast !== 0) parts.push(`kontrast ${signed(s.contrast)}`);
  if (s.saturation !== 0) parts.push(`nasycenie ${signed(s.saturation)}`);
  if (s.temperature !== 0) parts.push(`temperatura ${signed(s.temperature)}`);
  if (s.vignette !== 0) parts.push(`winieta ${s.vignette}`);
  if (s.grayscale) parts.push('czarno-biały');
  return `Korekty: ${parts.join(', ') || 'brak zmian'}`;
}

/** Walidacja/normalizacja payloadu presetu (z API i z localStorage). */
export function sanitizeAdjustments(raw: unknown): AdjustmentSettings {
  const o = (raw ?? {}) as Record<string, unknown>;
  const clamp = (v: unknown, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : 0;
  };
  return {
    brightness: clamp(o.brightness, -50, 50),
    contrast: clamp(o.contrast, -50, 50),
    saturation: clamp(o.saturation, -50, 50),
    temperature: clamp(o.temperature, -50, 50),
    vignette: clamp(o.vignette, 0, 100),
    grayscale: o.grayscale === true,
  };
}
