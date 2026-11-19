// Czyste obliczenia metryk reklam dla narzędzi MCP (bez dostępu do bazy —
// testowane w src/lib/__tests__/mcp-metrics.test.ts).
//
// Definicje:
//   spend, conversion_value — PLN (ETL przelicza konta EUR po kursie NBP z dnia)
//   CTR = clicks / impressions × 100; CPC = spend / clicks; CPM = spend / impressions × 1000
//   ROAS = conversion_value / spend; CPA = spend / conversions (wybrane okno atrybucji)
//   hook_rate = video_play_3s / impressions × 100
//   hold_rate = thruplays / video_play_3s × 100
//   krzywa wideo p25…p100 = % odtworzeń 3 s, które dotrwały do danego punktu
//   reach/frequency: suma dziennych reach (Meta deduplikuje tylko w obrębie dnia)
//     — frequency = impressions / suma dziennych reach, czyli średnia dzienna
//     częstotliwość (dolna granica częstotliwości w całym okresie).

export const ATTRIBUTIONS = ['7d_click', '1d_click', '1d_view'] as const;
export type Attribution = (typeof ATTRIBUTIONS)[number];

export const LEVELS = ['campaign', 'adset', 'ad', 'creative'] as const;
export type Level = (typeof LEVELS)[number];

export interface AdRow {
  date: string;
  account_id: string;
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
  creative_id: string | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  spend: number | null;
  /** Konwersje w domyślnym oknie konta — tylko do wykrycia braku danych atrybucji. */
  conversions: number | null;
  conversions_1d_click: number | null;
  conversions_7d_click: number | null;
  conversions_1d_view: number | null;
  conversion_value_1d_click: number | null;
  conversion_value_7d_click: number | null;
  conversion_value_1d_view: number | null;
  video_play_3s: number | null;
  video_p25_watched: number | null;
  video_p50_watched: number | null;
  video_p75_watched: number | null;
  video_p95_watched: number | null;
  video_p100_watched: number | null;
  thruplays: number | null;
}

export const AD_ROW_COLUMNS = [
  'date', 'account_id', 'campaign_id', 'campaign_name', 'adset_id', 'adset_name',
  'ad_id', 'ad_name', 'creative_id', 'impressions', 'reach', 'clicks', 'spend',
  'conversions', 'conversions_1d_click', 'conversions_7d_click', 'conversions_1d_view',
  'conversion_value_1d_click', 'conversion_value_7d_click', 'conversion_value_1d_view',
  'video_play_3s', 'video_p25_watched', 'video_p50_watched', 'video_p75_watched',
  'video_p95_watched', 'video_p100_watched', 'thruplays',
].join(',');

export interface Totals {
  spend: number;
  impressions: number;
  reach: number;
  maxDailyReach: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  defaultConversions: number;
  play3s: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  p100: number;
  thruplays: number;
  days: Set<string>;
  firstDay: string | null;
  lastDay: string | null;
}

export function emptyTotals(): Totals {
  return {
    spend: 0, impressions: 0, reach: 0, maxDailyReach: 0, clicks: 0, conversions: 0, conversionValue: 0, defaultConversions: 0,
    play3s: 0, p25: 0, p50: 0, p75: 0, p95: 0, p100: 0, thruplays: 0,
    days: new Set(), firstDay: null, lastDay: null,
  };
}

const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

export function conversionsFor(row: AdRow, attribution: Attribution): { conversions: number; value: number } {
  switch (attribution) {
    case '1d_click': return { conversions: n(row.conversions_1d_click), value: n(row.conversion_value_1d_click) };
    case '1d_view': return { conversions: n(row.conversions_1d_view), value: n(row.conversion_value_1d_view) };
    default: return { conversions: n(row.conversions_7d_click), value: n(row.conversion_value_7d_click) };
  }
}

export function addRow(t: Totals, row: AdRow, attribution: Attribution): void {
  const spend = n(row.spend);
  const { conversions, value } = conversionsFor(row, attribution);
  t.spend += spend;
  t.impressions += n(row.impressions);
  t.reach += n(row.reach);
  t.maxDailyReach = Math.max(t.maxDailyReach, n(row.reach));
  t.clicks += n(row.clicks);
  t.conversions += conversions;
  t.conversionValue += value;
  t.defaultConversions += n(row.conversions);
  t.play3s += n(row.video_play_3s);
  t.p25 += n(row.video_p25_watched);
  t.p50 += n(row.video_p50_watched);
  t.p75 += n(row.video_p75_watched);
  t.p95 += n(row.video_p95_watched);
  t.p100 += n(row.video_p100_watched);
  t.thruplays += n(row.thruplays);
  if (spend > 0 || n(row.impressions) > 0) {
    t.days.add(row.date);
    if (!t.firstDay || row.date < t.firstDay) t.firstDay = row.date;
    if (!t.lastDay || row.date > t.lastDay) t.lastDay = row.date;
  }
}

const round = (v: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
const ratio = (num: number, den: number, mult = 1, digits = 2): number | null =>
  den > 0 ? round((num / den) * mult, digits) : null;

export interface Metrics {
  spend: number;
  impressions: number;
  reach: number;
  frequency: number | null;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  conversions: number;
  conversion_value: number;
  roas: number | null;
  cpa: number | null;
  hook_rate: number | null;
  hold_rate: number | null;
  video_curve: { p25: number | null; p50: number | null; p75: number | null; p95: number | null; p100: number | null } | null;
  days_active: number;
}

export function finalize(t: Totals): Metrics {
  const isVideo = t.play3s > 0;
  return {
    spend: round(t.spend),
    impressions: t.impressions,
    reach: t.reach,
    frequency: ratio(t.impressions, t.reach),
    clicks: t.clicks,
    ctr: ratio(t.clicks, t.impressions, 100),
    cpc: ratio(t.spend, t.clicks),
    cpm: ratio(t.spend, t.impressions, 1000),
    conversions: round(t.conversions, 2),
    conversion_value: round(t.conversionValue),
    roas: ratio(t.conversionValue, t.spend),
    cpa: ratio(t.spend, t.conversions),
    hook_rate: isVideo ? ratio(t.play3s, t.impressions, 100) : null,
    hold_rate: isVideo ? ratio(t.thruplays, t.play3s, 100) : null,
    video_curve: isVideo
      ? {
          p25: ratio(t.p25, t.play3s, 100, 1),
          p50: ratio(t.p50, t.play3s, 100, 1),
          p75: ratio(t.p75, t.play3s, 100, 1),
          p95: ratio(t.p95, t.play3s, 100, 1),
          p100: ratio(t.p100, t.play3s, 100, 1),
        }
      : null,
    days_active: t.days.size,
  };
}

/** Zmiana procentowa (null, gdy brak bazy do porównania). */
export function pct(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null || prev === 0) return null;
  return round(((curr - prev) / Math.abs(prev)) * 100, 1);
}

export interface Group {
  key: string;
  totals: Totals;
  /** Ostatni wiersz grupy — najnowsze nazwy (po zmianie nazwy w Meta). */
  sample: AdRow;
  adIds: Set<string>;
  adsetIds: Set<string>;
  campaignIds: Set<string>;
}

export const NO_CREATIVE_KEY = '(brak creative_id)';

export function keyFor(row: AdRow, level: Level): string {
  switch (level) {
    case 'campaign': return row.campaign_id;
    case 'adset': return row.adset_id;
    case 'ad': return row.ad_id;
    default: return row.creative_id || NO_CREATIVE_KEY;
  }
}

export function groupRows(rows: AdRow[], level: Level, attribution: Attribution): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const key = keyFor(row, level);
    let g = groups.get(key);
    if (!g) {
      g = { key, totals: emptyTotals(), sample: row, adIds: new Set(), adsetIds: new Set(), campaignIds: new Set() };
      groups.set(key, g);
    }
    addRow(g.totals, row, attribution);
    if (row.date >= g.sample.date) g.sample = row;
    g.adIds.add(row.ad_id);
    g.adsetIds.add(row.adset_id);
    g.campaignIds.add(row.campaign_id);
  }
  return groups;
}

export const SORT_KEYS = ['spend', 'roas', 'cpa', 'ctr', 'hook_rate'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/** Sortowanie malejąco; CPA rośnie = gorzej, więc CPA sortujemy rosnąco. Puste na końcu. */
export function compareBy(key: SortKey) {
  return (a: Metrics, b: Metrics): number => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return b.spend - a.spend;
    if (av == null) return 1;
    if (bv == null) return -1;
    return key === 'cpa' ? av - bv : bv - av;
  };
}

// ── Zmęczenie kreacji ──────────────────────────────────────

export interface FatigueThresholds {
  minFrequency: number;   // domyślnie 3
  ctrDropPct: number;     // domyślnie 20
  cpaRisePct: number;     // domyślnie 30
}

export const DEFAULT_FATIGUE: FatigueThresholds = { minFrequency: 3, ctrDropPct: 20, cpaRisePct: 30 };

export interface FatigueVerdict {
  fatigued: boolean;
  reasons: string[];
  ctr_change_pct: number | null;
  cpa_change_pct: number | null;
}

/**
 * Reguła ze specyfikacji: (frequency > 3 ORAZ CTR spadł o > 20%) LUB CPA wzrósł o > 30%.
 * Brak konwersji w bieżącym oknie przy konwersjach w poprzednim = CPA „nieskończony” → wzrost.
 */
export function fatigueVerdict(curr: Metrics, prev: Metrics, th: FatigueThresholds = DEFAULT_FATIGUE): FatigueVerdict {
  const reasons: string[] = [];
  const ctrChange = pct(curr.ctr, prev.ctr);
  let cpaChange = pct(curr.cpa, prev.cpa);

  const freq = curr.frequency ?? 0;
  if (freq > th.minFrequency && ctrChange != null && ctrChange < -th.ctrDropPct) {
    reasons.push(`frequency ${freq} > ${th.minFrequency} i CTR ${ctrChange}% okno do okna`);
  }
  if (cpaChange != null && cpaChange > th.cpaRisePct) {
    reasons.push(`CPA +${cpaChange}% okno do okna`);
  } else if (curr.conversions === 0 && prev.conversions > 0 && curr.spend > 0) {
    cpaChange = null;
    reasons.push('brak konwersji w bieżącym oknie (w poprzednim były)');
  }
  return { fatigued: reasons.length > 0, reasons, ctr_change_pct: ctrChange, cpa_change_pct: cpaChange };
}

// ── Daty ───────────────────────────────────────────────────

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}

/** Poprzedni okres tej samej długości, bezpośrednio przed [from, to]. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const len = daysBetweenInclusive(from, to);
  const prevTo = shiftDays(from, -1);
  return { from: shiftDays(prevTo, -(len - 1)), to: prevTo };
}
