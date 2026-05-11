import { NextRequest, NextResponse } from 'next/server';
import { syncShowroomSales } from '@/lib/sensmax/sales';

export const maxDuration = 120;

async function run() {
  try {
    const result = await syncShowroomSales();
    return NextResponse.json({ ok: true, showrooms: result });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// Vercel Cron triggers a GET request.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.ETL_CRON_SECRET || process.env.SENSMAX_CRON_SECRET;
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return run();
}

export async function POST() {
  return run();
}
