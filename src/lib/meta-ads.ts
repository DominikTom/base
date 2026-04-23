const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// Każda marka ma osobną apkę Meta w swoim portfolio biznesowym → token per ad account.
// META_AD_ACCOUNTS format: "act_123:EAA_token_A,act_456:EAA_token_B,act_789:EAA_token_C"
function parseAccountEntries(): Array<{ accountId: string; token: string }> {
  const raw = process.env.META_AD_ACCOUNTS ?? '';
  const entries: Array<{ accountId: string; token: string }> = [];
  for (const chunk of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    const colonAt = chunk.indexOf(':');
    if (colonAt < 0) continue;
    const accountId = chunk.slice(0, colonAt).trim();
    const token = chunk.slice(colonAt + 1).trim();
    if (accountId && token) entries.push({ accountId, token });
  }
  return entries;
}

function getAccessTokenFor(accountId: string): string {
  const entry = parseAccountEntries().find(e => e.accountId === accountId);
  if (!entry) throw new Error(`META_AD_ACCOUNTS: no token configured for ${accountId}`);
  return entry.token;
}

export function getAdAccountIds(): string[] {
  return parseAccountEntries().map(e => e.accountId);
}

export interface MetaInsightRow {
  date: string;
  campaignId: string;
  campaignName: string;
  adsetName: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  cpc: number;
  cpm: number;
  ctr: number;
  accountId: string;
  currency: string;
}

export async function fetchAccountCurrency(accountId: string): Promise<string> {
  const token = getAccessTokenFor(accountId);
  const res = await fetch(`${META_BASE_URL}/${accountId}?fields=currency&access_token=${token}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta API error fetching currency for ${accountId}: ${text}`);
  }
  const data = await res.json();
  return data.currency || 'PLN';
}

export async function fetchCampaignInsights(
  accountId: string,
  dateFrom: string,
  dateTo: string
): Promise<MetaInsightRow[]> {
  const token = getAccessTokenFor(accountId);
  const currency = await fetchAccountCurrency(accountId);

  const fields = [
    'campaign_id', 'campaign_name', 'adset_name',
    'spend', 'impressions', 'clicks',
    'cpc', 'cpm', 'ctr',
    'actions', 'action_values',
  ].join(',');

  const rows: MetaInsightRow[] = [];
  let url: string | null = `${META_BASE_URL}/${accountId}/insights?fields=${fields}&time_range=%7B%22since%22%3A%22${dateFrom}%22%2C%22until%22%3A%22${dateTo}%22%7D&time_increment=1&level=campaign&limit=500&access_token=${token}` as string | null;

  while (url) {
    const res: Response = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta API error: ${text}`);
    }
    const json = await res.json();

    for (const row of json.data || []) {
      let conversions = 0;
      let conversionValue = 0;

      if (row.actions) {
        const purchase = row.actions.find((a: { action_type: string }) => a.action_type === 'purchase');
        if (purchase) conversions = parseInt(purchase.value || '0');
      }
      if (row.action_values) {
        const purchaseVal = row.action_values.find((a: { action_type: string }) => a.action_type === 'purchase');
        if (purchaseVal) conversionValue = parseFloat(purchaseVal.value || '0');
      }

      rows.push({
        date: row.date_start,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name || '',
        adsetName: row.adset_name || '',
        spend: parseFloat(row.spend || '0'),
        impressions: parseInt(row.impressions || '0'),
        clicks: parseInt(row.clicks || '0'),
        conversions,
        conversionValue,
        cpc: parseFloat(row.cpc || '0'),
        cpm: parseFloat(row.cpm || '0'),
        ctr: parseFloat(row.ctr || '0'),
        accountId,
        currency,
      });
    }

    // Pagination
    url = json.paging?.next || null;
  }

  return rows;
}

// =============================================================
// AD-LEVEL FETCHERS (Phase 1 creative analytics)
// =============================================================

export interface MetaAdInsightRow {
  date: string;
  accountId: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  adId: string;
  adName: string;
  creativeId: string | null;
  currency: string;
  impressions: number;
  reach: number;
  clicks: number;
  spend: number;
  conversions: number;
  conversionValue: number;
  cpc: number;
  cpm: number;
  ctr: number;
  frequency: number;
  videoPlay3s: number;
  videoP25: number;
  videoP50: number;
  videoP75: number;
  videoP95: number;
  videoP100: number;
  thruplays: number;
}

export interface MetaCreativeMeta {
  creativeId: string;
  accountId: string;
  title: string | null;
  body: string | null;
  callToActionType: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  videoId: string | null;
  permalinkUrl: string | null;
  format: 'video' | 'image' | 'carousel' | 'dynamic' | 'unknown';
  aspectRatio: string | null;
  durationSec: number | null;
  autoTags: string[];
}

function extractAction(arr: Array<{ action_type: string; value?: string }> | undefined, type: string): number {
  if (!arr) return 0;
  const row = arr.find(a => a.action_type === type);
  return row ? parseFloat(row.value || '0') : 0;
}

function extractVideoMetric(arr: Array<{ action_type: string; value?: string }> | undefined): number {
  // Meta zwraca video metrics jako actions z kluczami video_p25_watched_actions itd.
  // ale przy ?fields=video_* dostajemy je osobno. Dla bezpieczeństwa — obie ścieżki.
  return arr?.[0]?.value ? parseFloat(arr[0].value) : 0;
}

export async function fetchAdInsights(
  accountId: string,
  dateFrom: string,
  dateTo: string
): Promise<MetaAdInsightRow[]> {
  const token = getAccessTokenFor(accountId);
  const currency = await fetchAccountCurrency(accountId);

  // Uwaga: fields z wideo breakdownami są drogie pod kątem CPU weighted rate limit,
  // ale Meta w jednym call'u potrafi je zwrócić razem z insights — bez dodatkowych tripów.
  const fields = [
    'ad_id', 'ad_name',
    'adset_id', 'adset_name',
    'campaign_id', 'campaign_name',
    'creative{id}',
    'impressions', 'reach', 'clicks', 'spend',
    'cpc', 'cpm', 'ctr', 'frequency',
    'actions', 'action_values',
    'video_play_actions',
    'video_p25_watched_actions',
    'video_p50_watched_actions',
    'video_p75_watched_actions',
    'video_p95_watched_actions',
    'video_p100_watched_actions',
    'video_thruplay_watched_actions',
  ].join(',');

  const rows: MetaAdInsightRow[] = [];
  let url: string | null = `${META_BASE_URL}/${accountId}/insights?fields=${fields}&time_range=%7B%22since%22%3A%22${dateFrom}%22%2C%22until%22%3A%22${dateTo}%22%7D&time_increment=1&level=ad&limit=200&access_token=${token}` as string | null;

  while (url) {
    const res: Response = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta AD API error: ${text}`);
    }
    const json = await res.json();

    for (const row of json.data || []) {
      rows.push({
        date: row.date_start,
        accountId,
        currency,
        campaignId: row.campaign_id || '',
        campaignName: row.campaign_name || '',
        adsetId: row.adset_id || '',
        adsetName: row.adset_name || '',
        adId: row.ad_id || '',
        adName: row.ad_name || '',
        creativeId: row.creative?.id || null,
        impressions: parseInt(row.impressions || '0'),
        reach: parseInt(row.reach || '0'),
        clicks: parseInt(row.clicks || '0'),
        spend: parseFloat(row.spend || '0'),
        conversions: extractAction(row.actions, 'purchase'),
        conversionValue: extractAction(row.action_values, 'purchase'),
        cpc: parseFloat(row.cpc || '0'),
        cpm: parseFloat(row.cpm || '0'),
        ctr: parseFloat(row.ctr || '0'),
        frequency: parseFloat(row.frequency || '0'),
        videoPlay3s: extractVideoMetric(row.video_play_actions),
        videoP25: extractVideoMetric(row.video_p25_watched_actions),
        videoP50: extractVideoMetric(row.video_p50_watched_actions),
        videoP75: extractVideoMetric(row.video_p75_watched_actions),
        videoP95: extractVideoMetric(row.video_p95_watched_actions),
        videoP100: extractVideoMetric(row.video_p100_watched_actions),
        thruplays: extractVideoMetric(row.video_thruplay_watched_actions),
      });
    }
    url = json.paging?.next || null;
  }

  return rows;
}

// Meta AdCreative object — pobiera thumbnail, copy, video, format
export async function fetchCreativeMeta(
  creativeId: string,
  accountId: string
): Promise<MetaCreativeMeta | null> {
  const token = getAccessTokenFor(accountId);
  const fields = [
    'id', 'name', 'title', 'body',
    'call_to_action_type',
    'thumbnail_url', 'image_url',
    'video_id', 'object_type',
    'effective_object_story_id',
    'instagram_permalink_url',
    'asset_feed_spec',
  ].join(',');

  const url = `${META_BASE_URL}/${creativeId}?fields=${fields}&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    // Kreacje bywają usunięte — nie wywalamy całego syncu
    console.warn(`fetchCreativeMeta failed for ${creativeId}: ${text.slice(0, 200)}`);
    return null;
  }
  const data = await res.json();

  // Format detection: video jeśli video_id, image jeśli image_url, carousel jeśli asset_feed_spec.
  let format: MetaCreativeMeta['format'] = 'unknown';
  if (data.video_id) format = 'video';
  else if (data.asset_feed_spec?.images && data.asset_feed_spec.images.length > 1) format = 'carousel';
  else if (data.image_url || data.thumbnail_url) format = 'image';

  // Auto-tags — deterministyczne z API, nie AI
  const autoTags: string[] = [];
  if (format !== 'unknown') autoTags.push(format);
  if (data.call_to_action_type) autoTags.push(`cta_${String(data.call_to_action_type).toLowerCase()}`);

  return {
    creativeId: data.id || creativeId,
    accountId,
    title: data.title || data.name || null,
    body: data.body || null,
    callToActionType: data.call_to_action_type || null,
    thumbnailUrl: data.thumbnail_url || null,
    imageUrl: data.image_url || null,
    videoId: data.video_id || null,
    permalinkUrl: data.instagram_permalink_url || data.effective_object_story_id || null,
    format,
    aspectRatio: null,  // wymaga osobnego call'a do /video lub /image — zostawiamy na Phase 4
    durationSec: null,
    autoTags,
  };
}
