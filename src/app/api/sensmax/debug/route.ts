import { NextRequest, NextResponse } from 'next/server';

// TEMPORARY diagnostic route — probes SensMax API endpoint/auth variants.
// Delete once the correct contract is identified.

export const dynamic = 'force-dynamic';

type Probe = {
  label: string;
  url: string;
  headers: Record<string, string>;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key') || process.env.SENSMAX_API_KEY || '';
  const reportId = searchParams.get('report') || '590939';
  const base = (process.env.SENSMAX_BASE_URL || 'https://my.sensmax.eu/api/v2').replace(/\/+$/, '');
  const root = base.replace(/\/api\/v2$/, '');

  if (!key) {
    return NextResponse.json({ error: 'pass ?key=<apikey>' }, { status: 400 });
  }

  const probes: Probe[] = [
    { label: 'report/{id} + header apikey', url: `${base}/report/${reportId}`, headers: { apikey: key } },
    { label: 'report/{id} + header x-api-key', url: `${base}/report/${reportId}`, headers: { 'x-api-key': key } },
    { label: 'report/{id} + header Authorization Bearer', url: `${base}/report/${reportId}`, headers: { Authorization: `Bearer ${key}` } },
    { label: 'report/{id}?apikey=', url: `${base}/report/${reportId}?apikey=${encodeURIComponent(key)}`, headers: {} },
    { label: 'reports/{id} + header apikey', url: `${base}/reports/${reportId}`, headers: { apikey: key } },
    { label: 'livereport/{id} + header apikey', url: `${base}/livereport/${reportId}`, headers: { apikey: key } },
    { label: 'report?id= + header apikey', url: `${base}/report?id=${reportId}`, headers: { apikey: key } },
    { label: 'sensors + header apikey (control)', url: `${base}/sensors`, headers: { apikey: key } },
    { label: 'root /api/sensors + header apikey', url: `${root}/api/sensors`, headers: { apikey: key } },
    { label: 'root /api/v2/sensors?apikey=', url: `${root}/api/v2/sensors?apikey=${encodeURIComponent(key)}`, headers: {} },
  ];

  const results = await Promise.all(
    probes.map(async (p) => {
      const started = Date.now();
      try {
        const res = await fetch(p.url, { headers: p.headers, cache: 'no-store' });
        const body = await res.text();
        let json: unknown;
        let jsonOk = false;
        try {
          json = JSON.parse(body);
          jsonOk = true;
        } catch {
          /* not json */
        }
        return {
          label: p.label,
          url: p.url.replace(key, '***'),
          status: res.status,
          finalUrl: res.url,
          contentType: res.headers.get('content-type'),
          jsonOk,
          bodySnippet: jsonOk ? json : body.slice(0, 300),
          ms: Date.now() - started,
        };
      } catch (error) {
        return { label: p.label, url: p.url.replace(key, '***'), error: error instanceof Error ? error.message : String(error), ms: Date.now() - started };
      }
    }),
  );

  console.log('[sensmax-debug]', JSON.stringify({ base, reportId, results }));
  return NextResponse.json({ base, reportId, results });
}
