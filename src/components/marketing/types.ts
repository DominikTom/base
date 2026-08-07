// Typy odpowiedzi /api/dashboard/marketing/ads po stronie klienta.

import type { AttributionWindow } from '@/lib/marketing-constants';

export interface AttributionMetrics {
  purchases: number;
  revenue: number;
  roas: number;
}

export interface Metrics {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  purchases: number;
  revenue: number;
  leads: number;
  roas: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cpl: number;
  frequency: number;
  costPerPurchase: number;
  hookRate: number;
  thruplays: number;
  attribution: Record<AttributionWindow, AttributionMetrics>;
}

export interface Deltas {
  spend: number | null;
  revenue: number | null;
  roas: number | null;
  purchases: number | null;
  leads: number | null;
  reach: number | null;
  cpm: number | null;
  ctr: number | null;
  cpl: number | null;
}

export interface AccountRow extends Metrics {
  accountId: string;
  shop: string;
  currency: string | null;
  deltas: Deltas | null;
}

export interface CampaignRow extends Metrics {
  campaignId: string;
  campaignName: string;
  accountId: string;
  shop: string;
  objective: string | null;
  status: string | null;
  dailyBudget: number | null;
  purpose: string | null;
  funnelStage: string | null;
  notes: string | null;
  tags: string[];
}

// Pola manualne kampanii edytowalne z dashboardu
export interface CampaignMetaFields {
  purpose: string | null;
  funnelStage: string | null;
  notes: string | null;
  tags: string[];
}

export interface AdsetRow extends Metrics {
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  accountId: string;
  shop: string;
}

export interface CreativeInfo {
  format: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  videoId: string | null;
  title: string | null;
  body: string | null;
  callToActionType: string | null;
  isDynamic: boolean;
  tags: string[];          // unia auto + AI + manualne (do filtrowania)
  manualTags: string[];    // tylko własne (edytowalne w modalu)
  manualNotes: string | null;
}

export interface AdRow extends Metrics {
  adId: string;
  adName: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  accountId: string;
  shop: string;
  creativeId: string | null;
  creative: CreativeInfo | null;
}

// Pokrycie zakresu dat danymi ad-level per konto — niekompletne konto
// tłumaczy "dziwne" liczby (identyczne sumy dla różnych zakresów itd.)
export interface DataQualityRow {
  accountId: string;
  shop: string;
  daysCovered: number;
  expectedDays: number;
  lastDate: string | null;
  complete: boolean;
}

export interface AdsPayload {
  period: { from: string; to: string };
  previous: { from: string; to: string };
  coverage: { from: string; to: string; rows: number } | null;
  dataQuality: DataQualityRow[];
  totals: Metrics & { deltas: Deltas };
  accounts: AccountRow[];
  campaigns: CampaignRow[];
  adsets: AdsetRow[];
  ads: AdRow[];
}

export interface AdDailyPoint {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  revenue: number;
  leads: number;
}

// Metryki wg wybranego okna atrybucji (fallback: okno domyślne konta)
export function attributed(m: Metrics, window: AttributionWindow): AttributionMetrics {
  return m.attribution?.[window] ?? { purchases: m.purchases, revenue: m.revenue, roas: m.roas };
}

export function imageProxyUrl(url: string, accountId: string): string {
  return `/api/dashboard/meta/image?url=${encodeURIComponent(url)}&account=${encodeURIComponent(accountId)}`;
}

export function imageProxyByAdUrl(adId: string, accountId: string): string {
  return `/api/dashboard/meta/image?adId=${encodeURIComponent(adId)}&account=${encodeURIComponent(accountId)}`;
}
