import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
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
export async function GET() {
  const _guard = await requireAdmin();
  if (_guard) return _guard;
  return run();
}

export async function POST() {
  const _guard = await requireAdmin();
  if (_guard) return _guard;
  return run();
}
