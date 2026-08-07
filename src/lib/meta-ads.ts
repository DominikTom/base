const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// Mapowanie Shop label → Meta Ad Account ID przeniesione do marketing-constants
// (client-safe, używane też przez frontend do orkiestracji syncu per konto).
// Re-export dla zgodności z istniejącymi importami serwerowymi.
export { SHOP_TO_META_ACCOUNT } from './marketing-constants';

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
  leads: number;
  // Rozbicie purchase na okna atrybucji; conversions/conversionValue = okno domyślne konta
  conversions1dClick: number;
  conversions7dClick: number;
  conversions1dView: number;
  conversionValue1dClick: number;
  conversionValue7dClick: number;
  conversionValue1dView: number;
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

export interface MetaCampaignRow {
  campaignId: string;
  accountId: string;
  name: string | null;
  objective: string | null;
  status: string | null;
  effectiveStatus: string | null;
  buyingType: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  startTime: string | null;
  stopTime: string | null;
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

type MetaActionEntry = {
  action_type: string;
  value?: string;
  '1d_click'?: string;
  '7d_click'?: string;
  '1d_view'?: string;
};

function extractAction(arr: MetaActionEntry[] | undefined, type: string): number {
  if (!arr) return 0;
  const row = arr.find(a => a.action_type === type);
  return row ? parseFloat(row.value || '0') : 0;
}

// Wartość akcji dla konkretnego okna atrybucji. Meta dokleja klucze
// '1d_click'/'7d_click'/'1d_view' do wpisów actions/action_values tylko gdy
// zapytanie zawiera action_attribution_windows; brak klucza = 0 dla okna.
function extractActionWindow(
  arr: MetaActionEntry[] | undefined,
  type: string,
  window: '1d_click' | '7d_click' | '1d_view'
): number {
  if (!arr) return 0;
  const row = arr.find(a => a.action_type === type);
  return row?.[window] ? parseFloat(row[window] || '0') : 0;
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

  // Okna atrybucji: Meta dokleja per-window wartości do actions/action_values.
  // Kolumny bazowe (value) pozostają oknem domyślnym konta (zwykle 7d_click+1d_view).
  const attributionWindows = encodeURIComponent(JSON.stringify(['1d_click', '7d_click', '1d_view']));

  const rows: MetaAdInsightRow[] = [];
  let url: string | null = `${META_BASE_URL}/${accountId}/insights?fields=${fields}&time_range=%7B%22since%22%3A%22${dateFrom}%22%2C%22until%22%3A%22${dateTo}%22%7D&time_increment=1&level=ad&limit=200&action_attribution_windows=${attributionWindows}&access_token=${token}` as string | null;

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
        leads: extractAction(row.actions, 'lead'),
        conversions1dClick: extractActionWindow(row.actions, 'purchase', '1d_click'),
        conversions7dClick: extractActionWindow(row.actions, 'purchase', '7d_click'),
        conversions1dView: extractActionWindow(row.actions, 'purchase', '1d_view'),
        conversionValue1dClick: extractActionWindow(row.action_values, 'purchase', '1d_click'),
        conversionValue7dClick: extractActionWindow(row.action_values, 'purchase', '7d_click'),
        conversionValue1dView: extractActionWindow(row.action_values, 'purchase', '1d_view'),
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

  // HD thumbnail — kolejność zależnie od typu kreacji.
  // Dla VIDEO: 1) /{video_id}?fields=picture HD poster
  //            2) object_story_spec.video_data.image_url (HD poster z creative spec)
  //            3) generic image_url
  //            4) reszta fallbacków
  // Dla STATIC: 1) image_url (full-res)
  //             2) object_story_spec.link_data.picture / photo_data.url
  //             3) asset_feed_spec / image_hash lookup
  //             4) thumbnail_url (low-res, last resort)
  let hdThumbnail: string | null = null;

  if (data.video_id) {
    // Priorytet: video.picture → video_data.image_url → fallbacki
    try {
      const vidRes = await fetch(
        `${META_BASE_URL}/${data.video_id}?fields=picture&access_token=${encodeURIComponent(token)}`
      );
      if (vidRes.ok) {
        const vidData = await vidRes.json();
        if (typeof vidData.picture === 'string' && vidData.picture.length > 0) {
          hdThumbnail = vidData.picture;
        }
      }
    } catch { /* non-fatal */ }

    if (!hdThumbnail) {
      hdThumbnail = data.object_story_spec?.video_data?.image_url || null;
    }
  } else {
    // Static — image_url to full-res asset
    hdThumbnail = data.image_url || null;
  }

  // Wspólne fallbacki w kolejności malejącej jakości
  if (!hdThumbnail && data.object_story_spec) {
    const oss = data.object_story_spec;
    hdThumbnail =
      oss?.link_data?.picture ||
      oss?.photo_data?.url ||
      oss?.link_data?.child_attachments?.[0]?.picture ||
      oss?.video_data?.image_url ||  // dla static które jednak mają video_data
      null;
  }

  if (!hdThumbnail && data.asset_feed_spec) {
    const afs = data.asset_feed_spec;
    hdThumbnail =
      afs?.images?.[0]?.url ||
      afs?.videos?.[0]?.thumbnail_url ||
      null;
  }

  // image_hash lookup → permanent permalink z /{account}/adimages
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

  // Last resort — low-res Meta thumbnail (lepsze niż nic)
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

// =============================================================
// CAMPAIGN DIMENSION
// =============================================================

export async function fetchCampaigns(accountId: string): Promise<MetaCampaignRow[]> {
  const token = getAccessTokenFor(accountId);
  const fields = [
    'id', 'name', 'objective', 'status', 'effective_status',
    'buying_type', 'daily_budget', 'lifetime_budget', 'start_time', 'stop_time',
  ].join(',');

  const rows: MetaCampaignRow[] = [];
  let url: string | null = `${META_BASE_URL}/${accountId}/campaigns?fields=${fields}&limit=200&access_token=${token}` as string | null;

  while (url) {
    const res: Response = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Meta /campaigns error for ${accountId}: ${text}`);
    }
    const json = await res.json();
    for (const c of json.data || []) {
      rows.push({
        campaignId: c.id,
        accountId,
        name: c.name || null,
        objective: c.objective || null,
        status: c.status || null,
        effectiveStatus: c.effective_status || null,
        buyingType: c.buying_type || null,
        // Meta zwraca budżety w najmniejszej jednostce waluty (grosze/centy)
        dailyBudget: c.daily_budget ? parseInt(c.daily_budget, 10) / 100 : null,
        lifetimeBudget: c.lifetime_budget ? parseInt(c.lifetime_budget, 10) / 100 : null,
        startTime: c.start_time || null,
        stopTime: c.stop_time || null,
      });
    }
    url = json.paging?.next || null;
  }

  return rows;
}

// =============================================================
// AD PREVIEW (iframe + wideo HD + obraz) — patrz docs proxy podglądu
// =============================================================

export const PREVIEW_FORMATS = [
  'DESKTOP_FEED_STANDARD',
  'MOBILE_FEED_STANDARD',
  'INSTAGRAM_STANDARD',
  'INSTAGRAM_STORY',
] as const;

// Natywny podgląd Meta: /{ad_id}/previews zwraca gotowy <iframe> renderujący
// reklamę jak w feedzie. Nie każdy format jest dostępny dla każdej reklamy —
// próbujemy po kolei aż któryś zwróci niepuste body. URL iframe'a jest
// podpisany i wygasa, stąd cache: 'no-store'.
export async function fetchAdPreviewHtml(
  adId: string,
  accountId: string,
  preferredFormat?: string
): Promise<{ html: string; format: string } | null> {
  const token = getAccessTokenFor(accountId);
  const formatsToTry = preferredFormat
    ? [preferredFormat, ...PREVIEW_FORMATS.filter(f => f !== preferredFormat)]
    : [...PREVIEW_FORMATS];

  for (const format of formatsToTry) {
    try {
      const res = await fetch(
        `${META_BASE_URL}/${adId}/previews?ad_format=${encodeURIComponent(format)}&access_token=${token}`,
        { cache: 'no-store' }
      );
      if (!res.ok) continue;
      const json = await res.json();
      let body: string | undefined = json?.data?.[0]?.body;
      if (!body) continue;
      // Meta czasem zwraca body z zakodowanymi encjami HTML
      body = body
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"');
      return { html: body, format };
    } catch {
      // pojedynczy format może paść — próbujemy następny
    }
  }
  return null;
}

// Świeży URL źródła MP4 (pełna rozdzielczość) + plakat HD. Source na fbcdn
// jest podpisany i wygasa — pobieramy przy KAŻDYM żądaniu, bez cache.
export async function fetchVideoSource(
  videoId: string,
  accountId: string
): Promise<{ source: string | null; poster: string | null }> {
  const token = getAccessTokenFor(accountId);
  const res = await fetch(
    `${META_BASE_URL}/${videoId}?fields=source,picture,thumbnails{uri,width,height}&access_token=${token}`,
    { cache: 'no-store' }
  );
  if (!res.ok) return { source: null, poster: null };
  const data = await res.json();

  let poster: string | null = null;
  const thumbs: Array<{ uri: string; width: number }> = data.thumbnails?.data || [];
  if (thumbs.length > 0) {
    poster = [...thumbs].sort((a, b) => b.width - a.width)[0].uri;
  }
  if (!poster) poster = data.picture || null;

  return { source: data.source || null, poster };
}

// Łańcuch priorytetów źródła obrazka dla proxy ?adId= — od pełnowymiarowego
// image_url, przez object_story_spec i miniatury wideo, po adimages z hasha;
// thumbnail_url (64 px) jest absolutnie ostatnim fallbackiem.
export async function resolveAdImageUrl(adId: string, accountId: string): Promise<string | null> {
  const token = getAccessTokenFor(accountId);
  const res = await fetch(
    `${META_BASE_URL}/${adId}?fields=creative{image_url,image_hash,thumbnail_url,video_id,object_story_spec}&access_token=${token}`,
    { cache: 'no-store' }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const creative = data.creative;
  if (!creative) return null;

  if (creative.image_url) return creative.image_url;
  if (creative.object_story_spec?.video_data?.image_url) {
    return creative.object_story_spec.video_data.image_url;
  }
  if (creative.object_story_spec?.link_data?.picture) {
    return creative.object_story_spec.link_data.picture;
  }

  if (creative.video_id) {
    const { poster } = await fetchVideoSource(creative.video_id, accountId);
    if (poster) return poster;
  }

  if (creative.image_hash) {
    try {
      const imgRes = await fetch(
        `${META_BASE_URL}/${accountId}/adimages?hashes=${encodeURIComponent(JSON.stringify([creative.image_hash]))}&fields=permalink_url,url,url_128&access_token=${token}`,
        { cache: 'no-store' }
      );
      if (imgRes.ok) {
        const imgData = await imgRes.json();
        const first = imgData?.data?.[0];
        if (first) return first.permalink_url || first.url || first.url_128 || null;
      }
    } catch { /* non-fatal */ }
  }

  return creative.thumbnail_url || null;
}
