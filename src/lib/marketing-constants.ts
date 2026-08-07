// Stałe współdzielone między API a komponentami klienckimi zakładki Marketing.
// Osobny plik (bez importów serwerowych), żeby nie wciągać supabase-js do bundla.

// Mapowanie Shop label → Meta Ad Account ID. Client-safe (same ID kont są
// publiczne w URL-ach Ads Managera); tokeny zostają wyłącznie w env serwera.
// Przy dodaniu nowej marki: wpis tutaj + para act_id:token w META_AD_ACCOUNTS.
export const SHOP_TO_META_ACCOUNT: Record<string, string> = {
  'mybed.pl': 'act_1681802382204753',
  'mybed.de': 'act_637792865917248',
  'mittohome.pl': 'act_797212915921530',
};

export const FUNNEL_STAGES = ['TOFU', 'MOFU', 'BOFU', 'Retargeting', 'Retencja'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

// Walidacja własnych tagów (kampanie i kreacje): tablica krótkich stringów,
// trim + dedup, max 15 tagów po 40 znaków. Zwraca null gdy wejście złe.
export function sanitizeTags(input: unknown): string[] | null {
  if (input === null || input === undefined) return [];
  if (!Array.isArray(input)) return null;
  if (input.some(t => typeof t !== 'string')) return null;
  const cleaned = Array.from(new Set(
    (input as string[]).map(t => t.trim()).filter(Boolean)
  ));
  if (cleaned.length > 15 || cleaned.some(t => t.length > 40)) return null;
  return cleaned;
}

export const ATTRIBUTION_WINDOWS = [
  { value: 'default', label: 'Domyślna (konto)' },
  { value: '1d_click', label: '1 dzień klik' },
  { value: '7d_click', label: '7 dni klik' },
  { value: '1d_view', label: '1 dzień view' },
] as const;
export type AttributionWindow = (typeof ATTRIBUTION_WINDOWS)[number]['value'];

// Czytelne etykiety celów kampanii Meta (ODAX)
export const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_SALES: 'Sprzedaż',
  OUTCOME_LEADS: 'Leady',
  OUTCOME_TRAFFIC: 'Ruch',
  OUTCOME_AWARENESS: 'Świadomość',
  OUTCOME_ENGAGEMENT: 'Aktywność',
  OUTCOME_APP_PROMOTION: 'Promocja aplikacji',
  // legacy objectives
  CONVERSIONS: 'Konwersje',
  LINK_CLICKS: 'Kliknięcia',
  LEAD_GENERATION: 'Leady',
  BRAND_AWARENESS: 'Świadomość',
  REACH: 'Zasięg',
  POST_ENGAGEMENT: 'Aktywność',
  VIDEO_VIEWS: 'Wyświetlenia wideo',
  PRODUCT_CATALOG_SALES: 'Sprzedaż z katalogu',
};
