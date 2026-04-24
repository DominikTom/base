const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// Mapowanie Shop label → Meta Ad Account ID (do filtrowania dashboardów per marka).
// Przy dodaniu nowej marki: dodaj wpis tutaj + parę act_id:token do META_AD_ACCOUNTS.
export const SHOP_TO_META_ACCOUNT: Record<string, string> = {
  'mybed.pl': 'act_1681802382204753',
  'mybed.de': 'act_637792865917248',
  'mittohome.pl': 'act_797212915921530',
};

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

export function getAccessTokenFor(accountId: string): string {
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
  isDynamic: boolean;
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

async function fetchAdCreativeMap(
  accountId: string,
  token: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let url: string | null = `${META_BASE_URL}/${accountId}/ads?fields=id,creative{id}&limit=500&access_token=${token}` as string | null;
  while (url) {
    const res: Response = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta /ads list error for ${accountId}: ${text}`);
    }
    const json = await res.json();
    for (const ad of json.data || []) {
      if (ad.id && ad.creative?.id) map.set(ad.id, ad.creative.id);
    }
    url = json.paging?.next || null;
  }
  return map;
}

export async function fetchAdInsights(
  accountId: string,
  dateFrom: string,
  dateTo: string
): Promise<MetaAdInsightRow[]> {
  const token = getAccessTokenFor(accountId);
  const currency = await fetchAccountCurrency(accountId);

  // Meta Insights API nie akceptuje `creative{id}` w fields — `creative` jest polem
  // na /ads, nie na /insights. Pobieramy więc mapę ad_id → creative_id osobnym callem.
  const creativeMap = await fetchAdCreativeMap(accountId, token);

  // Uwaga: fields z wideo breakdownami są drogie pod kątem CPU weighted rate limit,
  // ale Meta w jednym call'u potrafi je zwrócić razem z insights — bez dodatkowych tripów.
  const fields = [
    'ad_id', 'ad_name',
    'adset_id', 'adset_name',
    'campaign_id', 'campaign_name',
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
        creativeId: creativeMap.get(row.ad_id) || null,
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
    'thumbnail_url', 'image_url', 'image_hash',
    'video_id', 'object_type',
    'effective_object_story_id',
    'instagram_permalink_url',
    'asset_feed_spec',
    'object_story_spec',
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

  // DPA detection: template_data / {{...}} w body / product_set_id
  // Meta Dynamic Product Ads są szablonami renderowanymi per user z katalogu.
  const bodyStr: string = typeof data.body === 'string' ? data.body : '';
  const hasTemplateVar = /\{\{[^}]+\}\}/.test(bodyStr);
  const hasTemplateData = !!data.object_story_spec?.template_data
    || !!data.asset_feed_spec?.asset_customization_rules;
  const hasProductSet = !!data.product_set_id
    || !!data.object_story_spec?.template_data?.link_data?.child_attachments
    || !!data.object_story_spec?.link_data?.multi_share_optimized;
  const isDynamic = hasTemplateVar || hasTemplateData || hasProductSet;

  // Format detection: dynamic jeśli DPA, inaczej video/carousel/image.
  let format: MetaCreativeMeta['format'] = 'unknown';
  if (isDynamic) format = 'dynamic';
  else if (data.video_id) format = 'video';
  else if (data.asset_feed_spec?.images && data.asset_feed_spec.images.length > 1) format = 'carousel';
  else if (data.image_url || data.thumbnail_url) format = 'image';

  // HD thumbnail — AdCreative.thumbnail_url jest 64×64, szukamy lepszego URL-a
  // idąc w kolejności priorytetu: video picture → image_url → object_story_spec →
  // asset_feed_spec → image_hash lookup → low-res fallback.
  let hdThumbnail: string | null = null;

  // 1) Video creative: Meta ma HD preview przez /{video_id}?fields=picture
  if (data.video_id) {
    try {
      const vidRes = await fetch(
        `${META_BASE_URL}/${data.video_id}?fields=picture&access_token=${encodeURIComponent(token)}`
      );
      if (vidRes.ok) {
        const vidData = await vidRes.json();
        if (typeof vidData.picture === 'string') hdThumbnail = vidData.picture;
      }
    } catch { /* non-fatal */ }
  }

  // 2) Static creative z image_url — już pełnowymiarowy
  if (!hdThumbnail && data.image_url) hdThumbnail = data.image_url;

  // 3) object_story_spec — link ads, page post ads, video ads z tego stylu
  if (!hdThumbnail && data.object_story_spec) {
    const oss = data.object_story_spec;
    hdThumbnail =
      oss?.link_data?.picture ||
      oss?.video_data?.image_url ||
      oss?.photo_data?.url ||
      oss?.link_data?.child_attachments?.[0]?.picture ||
      null;
  }

  // 4) asset_feed_spec — Advantage+ / dynamic creative
  if (!hdThumbnail && data.asset_feed_spec) {
    const afs = data.asset_feed_spec;
    hdThumbnail =
      afs?.images?.[0]?.url ||
      afs?.videos?.[0]?.thumbnail_url ||
      null;
  }

  // 5) image_hash lookup — last stable resort przez /{account}/adimages
  const imageHash =
    data.image_hash ||
    data.object_story_spec?.link_data?.image_hash ||
    data.asset_feed_spec?.images?.[0]?.hash;
  if (!hdThumbnail && imageHash) {
    try {
      const imgRes = await fetch(
        `${META_BASE_URL}/${accountId}/adimages?hashes=${encodeURIComponent(JSON.stringify([imageHash]))}&fields=hash,permalink_url,url&access_token=${encodeURIComponent(token)}`
      );
      if (imgRes.ok) {
        const imgData = await imgRes.json();
        const first = imgData?.data?.[0];
        if (first) hdThumbnail = first.permalink_url || first.url || null;
      }
    } catch { /* non-fatal */ }
  }

  // 6) Absolute fallback — low-res thumbnail (lepsze niż nic)
  if (!hdThumbnail) hdThumbnail = data.thumbnail_url || null;

  // Auto-tags — deterministyczne z API, nie AI
  const autoTags: string[] = [];
  if (format !== 'unknown') autoTags.push(format);
  if (isDynamic) autoTags.push('dpa');
  if (data.call_to_action_type) autoTags.push(`cta_${String(data.call_to_action_type).toLowerCase()}`);

  return {
    creativeId: data.id || creativeId,
    accountId,
    title: data.title || data.name || null,
    body: data.body || null,
    callToActionType: data.call_to_action_type || null,
    thumbnailUrl: hdThumbnail,
    imageUrl: data.image_url || null,
    videoId: data.video_id || null,
    permalinkUrl: data.instagram_permalink_url || data.effective_object_story_id || null,
    format,
    aspectRatio: null,  // wymaga osobnego call'a do /video lub /image — zostawiamy na Phase 4
    durationSec: null,
    autoTags,
    isDynamic,
  };
}
