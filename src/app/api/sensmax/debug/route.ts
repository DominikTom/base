import { NextRequest, NextResponse } from 'next/server';

// TEMPORARY diagnostic route — probes SensMax API endpoints.
// Delete once the correct contract is identified.

export const dynamic = 'force-dynamic';

type Probe = { label: string; path: string };

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key') || process.env.SENSMAX_API_KEY || '';
  const serial = searchParams.get('serial') || '030013921'; // My Bed Katowice
  const group = searchParams.get('group') || 'c9832';
  const reportId = searchParams.get('report') || '590939';
  const base = (process.env.SENSMAX_BASE_URL || 'https://my.sensmax.eu/api/v2').replace(/\/+$/, '');
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

  if (!key) return NextResponse.json({ error: 'pass ?key=<apikey>' }, { status: 400 });

  const probes: Probe[] = [
    { label: 'sensors (control)', path: `/sensors` },
    { label: 'sensor/{serial}', path: `/sensor/${serial}` },
    { label: 'sensor/{serial}/data range', path: `/sensor/${serial}/data?start=${weekAgo}&end=${today}` },
    { label: 'sensor/{serial}/updateddates', path: `/sensor/${serial}/updateddates` },
    { label: 'sensor/{serial}/updated_data_dates', path: `/sensor/${serial}/updated_data_dates` },
    { label: 'sensor/{serial}/online', path: `/sensor/${serial}/online` },
    { label: 'sensor/{serial}/realtime', path: `/sensor/${serial}/realtime` },
    { label: 'sensor/{serial}/livedata', path: `/sensor/${serial}/livedata` },
    { label: 'sensor/{serial}/last', path: `/sensor/${serial}/last` },
    { label: 'sensor/{serial}/status', path: `/sensor/${serial}/status` },
    { label: 'sensor/{serial}/counter', path: `/sensor/${serial}/counter` },
    { label: 'sensor/{serial}/inside', path: `/sensor/${serial}/inside` },
    { label: 'groups', path: `/groups` },
    { label: 'group/{group}', path: `/group/${group}` },
    { label: 'group/{group}/online', path: `/group/${group}/online` },
    { label: 'group/{group}/realtime', path: `/group/${group}/realtime` },
    { label: 'reports', path: `/reports` },
    { label: 'report (no id)', path: `/report` },
    { label: 'report/{id}/online', path: `/report/${reportId}/online` },
    { label: 'report/{id}/data', path: `/report/${reportId}/data` },
    { label: 'realtime', path: `/realtime` },
    { label: 'online', path: `/online` },
    { label: 'livereports', path: `/livereports` },
    { label: 'account', path: `/account` },
    { label: 'me', path: `/me` },
  ];

  const results = await Promise.all(
    probes.map(async (p) => {
      const started = Date.now();
      try {
        const res = await fetch(`${base}${p.path}`, { headers: { apikey: key }, cache: 'no-store' });
        const body = await res.text();
        let json: unknown;
        let jsonOk = false;
        try { json = JSON.parse(body); jsonOk = true; } catch { /* not json */ }
        return {
          label: p.label,
          path: p.path,
          status: res.status,
          finalPath: res.url.replace(base, ''),
          contentType: res.headers.get('content-type'),
          jsonOk,
          body: jsonOk ? json : body.slice(0, 200),
          ms: Date.now() - started,
        };
      } catch (error) {
        return { label: p.label, path: p.path, error: error instanceof Error ? error.message : String(error), ms: Date.now() - started };
      }
    }),
  );

  const hits = results.filter((r): r is typeof r & { jsonOk: true } => 'jsonOk' in r && r.jsonOk === true);
  console.log('[sensmax-debug]', JSON.stringify({ base, serial, group, reportId, hits: hits.map((h) => h.label), results }));
  return NextResponse.json({ base, serial, group, reportId, jsonHits: hits, allResults: results });
}
