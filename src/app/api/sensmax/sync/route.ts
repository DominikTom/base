import { NextRequest, NextResponse } from 'next/server';
import { refreshSensorsList, syncHistorical } from '@/lib/sensmax/sync';

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const cron = request.headers.get('x-vercel-cron');
  const secret = process.env.SENSMAX_CRON_SECRET;

  const allowed = cron === '1' || (Boolean(secret) && auth === `Bearer ${secret}`);
  if (!allowed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sensors_refreshed = await refreshSensorsList();
    const summary = await syncHistorical();
    return NextResponse.json({ sensors_refreshed, ...summary });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
