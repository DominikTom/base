import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
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
export async function GET() {
  const _guard = await requireAdmin();
  if (_guard) return _guard;
  return runSync();
}

// Manual trigger (matches the unauthenticated pattern of /api/etl/* manual POSTs).
export async function POST() {
  const _guard = await requireAdmin();
  if (_guard) return _guard;
  return runSync();
}
