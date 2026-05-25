import { NextRequest, NextResponse } from 'next/server';
import { getShowroomToday } from '@/lib/sensmax/today';
import { SHOWROOMS, type Showroom } from '@/lib/sensmax/types';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ showroom: string }> }) {
  const { showroom } = await params;
  if (!SHOWROOMS.includes(showroom as Showroom)) {
    return NextResponse.json({ error: 'Invalid showroom' }, { status: 400 });
  }

  try {
    const data = await getShowroomToday(showroom as Showroom);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
