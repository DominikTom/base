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
}

export async function fetchGA4Report(
  propertyId: string,
  dateFrom: string,
  dateTo: string
): Promise<GA4Row[]> {
  const auth = getAuth();
  const analytics = google.analyticsdata({ version: 'v1beta', auth });

  const response = await analytics.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
      dimensions: [
        { name: 'date' },
        { name: 'sessionSource' },
        { name: 'sessionMedium' },
        { name: 'sessionCampaignName' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'newUsers' },
        { name: 'screenPageViews' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
        { name: 'transactions' },
        { name: 'purchaseRevenue' },
      ],
    },
  });

  const hostname = getHostname(propertyId);
  const rows: GA4Row[] = [];

  for (const row of response.data.rows || []) {
    const dims = row.dimensionValues || [];
    const mets = row.metricValues || [];

    // GA4 returns date as YYYYMMDD
    const rawDate = dims[0]?.value || '';
    const date = rawDate.length === 8
      ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
      : rawDate;

    rows.push({
      date,
      source: dims[1]?.value || '(direct)',
      medium: dims[2]?.value || '(none)',
      campaign: dims[3]?.value || '',
      hostname,
      sessions: parseInt(mets[0]?.value || '0'),
      users: parseInt(mets[1]?.value || '0'),
      newUsers: parseInt(mets[2]?.value || '0'),
      pageviews: parseInt(mets[3]?.value || '0'),
      bounceRate: parseFloat(mets[4]?.value || '0'),
      avgSessionDuration: parseFloat(mets[5]?.value || '0'),
      transactions: parseInt(mets[6]?.value || '0'),
      gaRevenue: parseFloat(mets[7]?.value || '0'),
    });
  }

  return rows;
}
