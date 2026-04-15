import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    const { data: logs, error } = await supabaseAdmin
      .from('etl_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Data freshness: latest successful run per source
    const freshness: Record<string, string> = {};
    for (const log of logs || []) {
      if (log.status === 'success' && !freshness[log.source]) {
        freshness[log.source] = log.finished_at;
      }
    }

    return NextResponse.json({ logs, freshness });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
