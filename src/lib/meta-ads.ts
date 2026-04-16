const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

function getAccessToken(): string {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error('META_ACCESS_TOKEN env var is not set');
  return token;
}

export function getAdAccountIds(): string[] {
  const ids = process.env.META_AD_ACCOUNT_IDS || '';
  return ids.split(',').map(s => s.trim()).filter(Boolean);
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
  const token = getAccessToken();
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
  const token = getAccessToken();
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
