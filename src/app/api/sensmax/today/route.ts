import { NextResponse } from 'next/server';
import { getShowroomToday } from '@/lib/sensmax/today';
import { SHOWROOMS } from '@/lib/sensmax/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const entries = await Promise.all(SHOWROOMS.map(async (s) => [s, await getShowroomToday(s)] as const));
    return NextResponse.json(Object.fromEntries(entries));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
