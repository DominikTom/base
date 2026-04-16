import { google } from 'googleapis';

const PROPERTY_HOSTNAME_MAP: Record<string, string> = {
  '298581907': 'mybed.pl',
  '478191159': 'mybed.de',
  '473912359': 'mittohome.pl',
};

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set');
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  });
}

export function getPropertyIds(): string[] {
  const ids = process.env.GA4_PROPERTY_IDS || '';
  return ids.split(',').map(s => s.trim()).filter(Boolean);
}

export function getHostname(propertyId: string): string {
  return PROPERTY_HOSTNAME_MAP[propertyId] || propertyId;
}

export interface GA4Row {
  date: string;
  source: string;
  medium: string;
  campaign: string;
  hostname: string;
  sessions: number;
  users: number;
  newUsers: number;
  pageviews: number;
  bounceRate: number;
  avgSessionDuration: number;
  transactions: number;
  gaRevenue: number;
  adCost: number;
  adClicks: number;
  adImpressions: number;
}

export interface GA4DailyTotal {
  date: string;
  hostname: string;
  sessions: number;
  users: number;
  newUsers: number;
  pageviews: number;
  transactions: number;
  gaRevenue: number;
  adCost: number;
  adClicks: number;
  adImpressions: number;
}

/**
 * Fetch accurate daily totals WITHOUT source/medium dimensions.
 * This matches GA4 native numbers exactly (no dimension-based attribution issues).
 */
export async function fetchGA4DailyTotals(
  propertyId: string,
  dateFrom: string,
  dateTo: string
): Promise<GA4DailyTotal[]> {
  const auth = getAuth();
  const analytics = google.analyticsdata({ version: 'v1beta', auth });
  const property = `properties/${propertyId}`;
  const dateRanges = [{ startDate: dateFrom, endDate: dateTo }];

  // Two parallel queries: traffic (date only) + ads (date + campaign, GA4 requirement)
  const [trafficRes, adsRes] = await Promise.all([
    analytics.properties.runReport({
      property,
      requestBody: {
        dateRanges,
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' },
          { name: 'screenPageViews' }, { name: 'transactions' }, { name: 'purchaseRevenue' },
        ],
      },
    }),
    analytics.properties.runReport({
      property,
      requestBody: {
        dateRanges,
        dimensions: [{ name: 'date' }, { name: 'sessionCampaignName' }],
        metrics: [
          { name: 'advertiserAdCost' }, { name: 'advertiserAdClicks' }, { name: 'advertiserAdImpressions' },
        ],
      },
    }),
  ]);

  const hostname = getHostname(propertyId);

  // Aggregate ads by date (sum across campaigns)
  const adsMap: Record<string, { cost: number; clicks: number; impressions: number }> = {};
  for (const row of adsRes.data.rows || []) {
    const d = row.dimensionValues || [];
    const m = row.metricValues || [];
    const date = d[0]?.value || '';
    if (!adsMap[date]) adsMap[date] = { cost: 0, clicks: 0, impressions: 0 };
    adsMap[date].cost += parseFloat(m[0]?.value || '0');
    adsMap[date].clicks += parseInt(m[1]?.value || '0');
    adsMap[date].impressions += parseInt(m[2]?.value || '0');
  }

  const rows: GA4DailyTotal[] = [];
  for (const row of trafficRes.data.rows || []) {
    const d = row.dimensionValues || [];
    const m = row.metricValues || [];
    const rawDate = d[0]?.value || '';
    const date = rawDate.length === 8
      ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
      : rawDate;
    rows.push({
      date, hostname,
      sessions: parseInt(m[0]?.value || '0'),
      users: parseInt(m[1]?.value || '0'),
      newUsers: parseInt(m[2]?.value || '0'),
      pageviews: parseInt(m[3]?.value || '0'),
      transactions: parseInt(m[4]?.value || '0'),
      gaRevenue: parseFloat(m[5]?.value || '0'),
      adCost: (adsMap[rawDate] || {}).cost || 0,
      adClicks: (adsMap[rawDate] || {}).clicks || 0,
      adImpressions: (adsMap[rawDate] || {}).impressions || 0,
    });
  }
  return rows;
}

/**
 * Fetch detailed traffic data WITH source/medium/campaign dimensions.
 * Used for source breakdown tables. Revenue/cost may differ from GA4 native
 * due to session-scoped attribution.
 */
export async function fetchGA4Report(
  propertyId: string,
  dateFrom: string,
  dateTo: string
): Promise<GA4Row[]> {
  const auth = getAuth();
  const analytics = google.analyticsdata({ version: 'v1beta', auth });
  const property = `properties/${propertyId}`;
  const dims = [
    { name: 'date' },
    { name: 'sessionSource' },
    { name: 'sessionMedium' },
    { name: 'sessionCampaignName' },
  ];
  const dateRanges = [{ startDate: dateFrom, endDate: dateTo }];

  const [trafficRes, adsRes] = await Promise.all([
    analytics.properties.runReport({
      property,
      requestBody: {
        dateRanges, dimensions: dims,
        metrics: [
          { name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' },
          { name: 'screenPageViews' }, { name: 'bounceRate' },
          { name: 'averageSessionDuration' }, { name: 'transactions' },
          { name: 'purchaseRevenue' },
        ],
      },
    }),
    analytics.properties.runReport({
      property,
      requestBody: {
        dateRanges, dimensions: dims,
        metrics: [
          { name: 'advertiserAdCost' }, { name: 'advertiserAdClicks' },
          { name: 'advertiserAdImpressions' },
        ],
      },
    }),
  ]);

  const hostname = getHostname(propertyId);
  const adsMap: Record<string, { cost: number; clicks: number; impressions: number }> = {};
  for (const row of adsRes.data.rows || []) {
    const d = row.dimensionValues || [];
    const m = row.metricValues || [];
    adsMap[`${d[0]?.value}|${d[1]?.value}|${d[2]?.value}|${d[3]?.value}`] = {
      cost: parseFloat(m[0]?.value || '0'),
      clicks: parseInt(m[1]?.value || '0'),
      impressions: parseInt(m[2]?.value || '0'),
    };
  }

  const rows: GA4Row[] = [];
  for (const row of trafficRes.data.rows || []) {
    const d = row.dimensionValues || [];
    const m = row.metricValues || [];
    const rawDate = d[0]?.value || '';
    const date = rawDate.length === 8 ? `${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}` : rawDate;
    const ads = adsMap[`${d[0]?.value}|${d[1]?.value}|${d[2]?.value}|${d[3]?.value}`] || { cost: 0, clicks: 0, impressions: 0 };
    rows.push({
      date, source: d[1]?.value || '(direct)', medium: d[2]?.value || '(none)',
      campaign: d[3]?.value || '', hostname,
      sessions: parseInt(m[0]?.value || '0'), users: parseInt(m[1]?.value || '0'),
      newUsers: parseInt(m[2]?.value || '0'), pageviews: parseInt(m[3]?.value || '0'),
      bounceRate: parseFloat(m[4]?.value || '0'), avgSessionDuration: parseFloat(m[5]?.value || '0'),
      transactions: parseInt(m[6]?.value || '0'), gaRevenue: parseFloat(m[7]?.value || '0'),
      adCost: ads.cost, adClicks: ads.clicks, adImpressions: ads.impressions,
    });
  }
  return rows;
}
