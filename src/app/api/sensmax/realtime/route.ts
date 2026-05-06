import { NextResponse } from 'next/server';
import { getRealtimeForShowroom } from '@/lib/sensmax/realtime';

export async function GET() {
  try {
    const [katowice, wroclaw, poznan] = await Promise.all([
      getRealtimeForShowroom('katowice'),
      getRealtimeForShowroom('wroclaw'),
      getRealtimeForShowroom('poznan'),
    ]);

    return NextResponse.json({ katowice, wroclaw, poznan });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
