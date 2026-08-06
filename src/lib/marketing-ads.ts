import { getSupabaseAdmin } from './supabase';
import { SHOP_TO_META_ACCOUNT } from './meta-ads';

// ============================================================
// Wspólne agregacje ad-level dla /api/dashboard/marketing/ads
// i /api/dashboard/marketing/export (CSV) — jedna logika, dwa formaty.
// ============================================================

export const META_ACCOUNT_TO_SHOP: Record<string, string> = Object.fromEntries(
  Object.entries(SHOP_TO_META_ACCOUNT).map(([shop, account]) => [account, shop])
);

export interface AdPerfRow {
  date: string;
  account_id: string;
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
  creative_id: string | null;
  impressions: number;
  reach: number;
  clicks: number;
  spend: number;
  spend_original: number;
  original_currency: string | null;
  conversions: number;
  conversion_value: number;
  leads: number | null;
  conversions_1d_click: number | null;
  conversions_7d_click: number | null;
  conversions_1d_view: number | null;
  conversion_value_1d_click: number | null;
  conversion_value_7d_click: number | null;
  conversion_value_1d_view: number | null;
  video_play_3s: number;
  video_p50_watched: number;
  video_p100_watched: number;
  thruplays: number;
}

const SELECT_COLUMNS = [
  'date', 'account_id',
  'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name', 'creative_id',
  'impressions', 'reach', 'clicks', 'spend', 'spend_original', 'original_currency',
  'conversions', 'conversion_value', 'leads',
  'conversions_1d_click', 'conversions_7d_click', 'conversions_1d_view',
  'conversion_value_1d_click', 'conversion_value_7d_click', 'conversion_value_1d_view',
  'video_play_3s', 'video_p50_watched', 'video_p100_watched', 'thruplays',
].join(',');

// Paginacja przeciw serwerowemu capowi 1000 wierszy PostgREST (jak w
// marketing/route.ts). accountIds: null = wszystkie konta; lista = multi-select
// sklepów zmapowany na account_id (filters.shop bywa CSV, patrz lib/shop-filter).
export async function fetchAdPerfRows(
  dateFrom: string,
  dateTo: string,
  accountIds: string[] | null
): Promise<AdPerfRow[]> {
  const db = getSupabaseAdmin();
  const PAGE_SIZE = 1000;
  const rows: AdPerfRow[] = [];
  let offset = 0;
  for (;;) {
    let query = db
      .from('fact_daily_ad_performance')
      .select(SELECT_COLUMNS)
      .eq('platform', 'meta')
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (accountIds && accountIds.length === 1) query = query.eq('account_id', accountIds[0]);
    else if (accountIds && accountIds.length > 1) query = query.in('account_id', accountIds);
    const { data, error } = await query;
    if (error) throw new Error(`fact_daily_ad_performance: ${error.message}`);
    const page = (data || []) as unknown as AdPerfRow[];
    if (page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

// Mapuje wartość filtra sklepu (CSV multi-selecta lub 'all') na listę
// account_id Meta. Sklepy bez konta Meta wpadają jako 'NONE' → 0 wierszy.
export function shopFilterToAccountIds(shop: string | null | undefined): string[] | null {
  if (!shop || shop === 'all') return null;
  const shops = shop.split(',').map(s => s.trim()).filter(Boolean);
  if (shops.length === 0) return null;
  return [...new Set(shops.map(s => SHOP_TO_META_ACCOUNT[s] ?? 'NONE'))];
}

// ============ Totals + metryki pochodne ============

export interface MetricTotals {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  purchases: number;
  revenue: number;
  leads: number;
  purchases1dClick: number;
  purchases7dClick: number;
  purchases1dView: number;
  revenue1dClick: number;
  revenue7dClick: number;
  revenue1dView: number;
  videoPlay3s: number;
  videoP50: number;
  videoP100: number;
  thruplays: number;
  days: Set<string>;
}

export function emptyTotals(): MetricTotals {
  return {
    spend: 0, impressions: 0, reach: 0, clicks: 0, purchases: 0, revenue: 0, leads: 0,
    purchases1dClick: 0, purchases7dClick: 0, purchases1dView: 0,
    revenue1dClick: 0, revenue7dClick: 0, revenue1dView: 0,
    videoPlay3s: 0, videoP50: 0, videoP100: 0, thruplays: 0,
    days: new Set<string>(),
  };
}

export function addRow(t: MetricTotals, r: AdPerfRow): void {
  t.spend += r.spend || 0;
  t.impressions += r.impressions || 0;
  t.reach += r.reach || 0;
  t.clicks += r.clicks || 0;
  t.purchases += r.conversions || 0;
  t.revenue += r.conversion_value || 0;
  t.leads += r.leads || 0;
  t.purchases1dClick += r.conversions_1d_click || 0;
  t.purchases7dClick += r.conversions_7d_click || 0;
  t.purchases1dView += r.conversions_1d_view || 0;
  t.revenue1dClick += r.conversion_value_1d_click || 0;
  t.revenue7dClick += r.conversion_value_7d_click || 0;
  t.revenue1dView += r.conversion_value_1d_view || 0;
  t.videoPlay3s += r.video_play_3s || 0;
  t.videoP50 += r.video_p50_watched || 0;
  t.videoP100 += r.video_p100_watched || 0;
  t.thruplays += r.thruplays || 0;
  t.days.add(r.date);
}

const r2 = (v: number) => Math.round(v * 100) / 100;

// Metryki pochodne. Uwaga na zasięg: suma dziennych reach zawyża unikalny
// zasięg okresu (Meta deduplikuje tylko w obrębie dnia) — traktujemy jako
// przybliżenie; frequency = impressions / suma dziennych reach.
export function finalizeTotals(t: MetricTotals) {
  return {
    spend: r2(t.spend),
    impressions: t.impressions,
    reach: t.reach,
    clicks: t.clicks,
    purchases: t.purchases,
    revenue: r2(t.revenue),
    leads: t.leads,
    roas: t.spend > 0 ? r2(t.revenue / t.spend) : 0,
    ctr: t.impressions > 0 ? r2((t.clicks / t.impressions) * 100) : 0,
    cpc: t.clicks > 0 ? r2(t.spend / t.clicks) : 0,
    cpm: t.impressions > 0 ? r2((t.spend / t.impressions) * 1000) : 0,
    cpl: t.leads > 0 ? r2(t.spend / t.leads) : 0,
    frequency: t.reach > 0 ? r2(t.impressions / t.reach) : 0,
    costPerPurchase: t.purchases > 0 ? r2(t.spend / t.purchases) : 0,
    hookRate: t.impressions > 0 && t.videoPlay3s > 0
      ? r2((t.videoPlay3s / t.impressions) * 100) : 0,
    thruplays: t.thruplays,
    attribution: {
      default: { purchases: t.purchases, revenue: r2(t.revenue), roas: t.spend > 0 ? r2(t.revenue / t.spend) : 0 },
      '1d_click': { purchases: t.purchases1dClick, revenue: r2(t.revenue1dClick), roas: t.spend > 0 ? r2(t.revenue1dClick / t.spend) : 0 },
      '7d_click': { purchases: t.purchases7dClick, revenue: r2(t.revenue7dClick), roas: t.spend > 0 ? r2(t.revenue7dClick / t.spend) : 0 },
      '1d_view': { purchases: t.purchases1dView, revenue: r2(t.revenue1dView), roas: t.spend > 0 ? r2(t.revenue1dView / t.spend) : 0 },
    },
  };
}

export type FinalizedMetrics = ReturnType<typeof finalizeTotals>;

// ============ Agregacje per wymiar ============

export interface AccountAgg extends FinalizedMetrics {
  accountId: string;
  shop: string;
  currency: string | null;
}

export interface CampaignAgg extends FinalizedMetrics {
  campaignId: string;
  campaignName: string;
  accountId: string;
  shop: string;
}

export interface AdsetAgg extends FinalizedMetrics {
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  accountId: string;
  shop: string;
}

export interface AdAgg extends FinalizedMetrics {
  adId: string;
  adName: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  accountId: string;
  shop: string;
  creativeId: string | null;
}

function groupBy<K extends string>(rows: AdPerfRow[], keyFn: (r: AdPerfRow) => K) {
  const map = new Map<K, { totals: MetricTotals; sample: AdPerfRow }>();
  for (const row of rows) {
    const key = keyFn(row);
    let entry = map.get(key);
    if (!entry) {
      entry = { totals: emptyTotals(), sample: row };
      map.set(key, entry);
    }
    addRow(entry.totals, row);
    entry.sample = row; // ostatni wiersz = najnowsze nazwy (rename-safe)
  }
  return map;
}

const shopOf = (accountId: string) => META_ACCOUNT_TO_SHOP[accountId] || accountId;

export function aggregateAccounts(rows: AdPerfRow[]): AccountAgg[] {
  return Array.from(groupBy(rows, r => r.account_id).entries())
    .map(([accountId, { totals, sample }]) => ({
      accountId,
      shop: shopOf(accountId),
      currency: sample.original_currency,
      ...finalizeTotals(totals),
    }))
    .sort((a, b) => b.spend - a.spend);
}

export function aggregateCampaigns(rows: AdPerfRow[]): CampaignAgg[] {
  return Array.from(groupBy(rows, r => r.campaign_id).entries())
    .map(([campaignId, { totals, sample }]) => ({
      campaignId,
      campaignName: sample.campaign_name || campaignId,
      accountId: sample.account_id,
      shop: shopOf(sample.account_id),
      ...finalizeTotals(totals),
    }))
    .sort((a, b) => b.spend - a.spend);
}

export function aggregateAdsets(rows: AdPerfRow[]): AdsetAgg[] {
  return Array.from(groupBy(rows, r => r.adset_id).entries())
    .map(([adsetId, { totals, sample }]) => ({
      adsetId,
      adsetName: sample.adset_name || adsetId,
      campaignId: sample.campaign_id,
      campaignName: sample.campaign_name || sample.campaign_id,
      accountId: sample.account_id,
      shop: shopOf(sample.account_id),
      ...finalizeTotals(totals),
    }))
    .sort((a, b) => b.spend - a.spend);
}

export function aggregateAds(rows: AdPerfRow[]): AdAgg[] {
  return Array.from(groupBy(rows, r => r.ad_id).entries())
    .map(([adId, { totals, sample }]) => ({
      adId,
      adName: sample.ad_name || adId,
      adsetId: sample.adset_id,
      adsetName: sample.adset_name || sample.adset_id,
      campaignId: sample.campaign_id,
      campaignName: sample.campaign_name || sample.campaign_id,
      accountId: sample.account_id,
      shop: shopOf(sample.account_id),
      creativeId: sample.creative_id,
      ...finalizeTotals(totals),
    }))
    .sort((a, b) => b.spend - a.spend);
}

// Porównanie okres-do-okresu: wspólne helpery previousPeriod/pctChange
// są w '@/lib/period-compare' — używamy ich zamiast lokalnych duplikatów.
