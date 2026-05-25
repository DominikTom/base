import { NextRequest, NextResponse } from 'next/server';
import { refreshSensorsList, syncHistorical } from '@/lib/sensmax/sync';

export const maxDuration = 120;

async function runSync() {
  try {
    const sensors_refreshed = await refreshSensorsList();
    const summary = await syncHistorical();
    return NextResponse.json({ sensors_refreshed, ...summary });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// Vercel Cron triggers a GET request (with the x-vercel-cron header).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.ETL_CRON_SECRET || process.env.SENSMAX_CRON_SECRET;
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runSync();
}

// Manual trigger (matches the unauthenticated pattern of /api/etl/* manual POSTs).
export async function POST() {
  return runSync();
}
