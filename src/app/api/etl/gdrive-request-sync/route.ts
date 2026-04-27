import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Queue manual Google Drive sync request.
// Actual heavy sync is executed by cron poll route to avoid request timeout in UI.
export async function POST() {
  try {
    const db = getSupabaseAdmin();

    // If there is already queued/running manual request, avoid duplicates.
    const { data: existing } = await db
      .from('etl_log')
      .select('id, status, started_at')
      .eq('source', 'gdrive_csv_manual')
      .in('status', ['queued', 'running'])
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        queued: true,
        deduplicated: true,
        message: 'Manual sync request is already queued or running.',
      });
    }

    const { data: row, error } = await db
      .from('etl_log')
      .insert({
        source: 'gdrive_csv_manual',
        started_at: new Date().toISOString(),
        status: 'queued',
      })
      .select('id')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      queued: true,
      requestId: row?.id,
      message: 'Manual sync queued. Cron poll should execute it within ~10 minutes.',
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
