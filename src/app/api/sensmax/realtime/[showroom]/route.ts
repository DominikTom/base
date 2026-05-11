import { NextRequest, NextResponse } from 'next/server';
import { getRealtimeForShowroom } from '@/lib/sensmax/realtime';
import type { Showroom } from '@/lib/sensmax/types';

const SHOWROOMS: Showroom[] = ['katowice', 'wroclaw', 'poznan'];

export async function GET(_request: NextRequest, { params }: { params: Promise<{ showroom: string }> }) {
  const { showroom } = await params;
  if (!SHOWROOMS.includes(showroom as Showroom)) {
    return NextResponse.json({ error: 'Invalid showroom' }, { status: 400 });
  }

  try {
    const data = await getRealtimeForShowroom(showroom as Showroom);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
