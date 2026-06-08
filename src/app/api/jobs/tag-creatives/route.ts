import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { classifyCreative, insightsToTags } from '@/lib/creative-tagger';

export const maxDuration = 60;

// POST — manual trigger (default batch 10)
// ?limit=N to override, ?retry_failed=1 to also pick 'failed' rows
export async function POST(request: NextRequest) {
  const _guard = await requireAdmin();
  if (_guard) return _guard;
  const { searchParams } = new URL(request.url);
  const limitParam = parseInt(searchParams.get('limit') || '10', 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 50
    ? limitParam : 10;
  const retryFailed = searchParams.get('retry_failed') === '1';
  return runTagging(limit, retryFailed);
}

// GET — cron-safe (sprawdza ETL_CRON_SECRET)
export async function GET(request: NextRequest) {
  const _guard = await requireAdmin();
  if (_guard) return _guard;
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const cronSecret = process.env.ETL_CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runTagging(10, false);
}

interface CreativeRow {
  creative_id: string;
  thumbnail_url: string | null;
  body: string | null;
  title: string | null;
  format: string | null;
}

async function runTagging(limit: number, retryFailed: boolean) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
    }

    const db = getSupabaseAdmin();

    const { data: etlLog } = await db
      .from('etl_log')
      .insert({ source: 'creative_tagging', started_at: new Date().toISOString(), status: 'running' })
      .select('id')
      .single();
    const etlLogId = etlLog?.id;

    try {
      const statusFilter = retryFailed ? ['pending', 'failed'] : ['pending'];
      const { data: pending, error } = await db
        .from('dim_creatives')
        .select('creative_id, thumbnail_url, body, title, format')
        .in('ai_tag_status', statusFilter)
        .not('thumbnail_url', 'is', null)
        .order('first_seen_at', { ascending: false })
        .limit(limit);

      if (error) throw new Error(`fetch pending: ${error.message}`);
      const rows = (pending || []) as CreativeRow[];

      if (rows.length === 0) {
        if (etlLogId) {
          await db.from('etl_log').update({
            status: 'success',
            finished_at: new Date().toISOString(),
            rows_processed: 0,
            rows_inserted: 0,
            error_message: 'no pending creatives',
          }).eq('id', etlLogId);
        }
        return NextResponse.json({ processed: 0, succeeded: 0, failed: 0, remaining: 0 });
      }

      // Oznacz je jako 'processing' żeby równoległe wywołania nie brały tych samych
      await db.from('dim_creatives')
        .update({ ai_tag_status: 'processing' })
        .in('creative_id', rows.map(r => r.creative_id));

      let succeeded = 0;
      let failed = 0;

      for (const row of rows) {
        if (!row.thumbnail_url) {
          await db.from('dim_creatives').update({
            ai_tag_status: 'skipped',
            ai_tag_error: 'no thumbnail_url',
            ai_tagged_at: new Date().toISOString(),
          }).eq('creative_id', row.creative_id);
          failed += 1;
          continue;
        }

        try {
          const insights = await classifyCreative({
            thumbnailUrl: row.thumbnail_url,
            adBody: row.body,
            adTitle: row.title,
            format: row.format,
          });

          if (!insights) {
            await db.from('dim_creatives').update({
              ai_tag_status: 'failed',
              ai_tag_error: 'classifyCreative returned null (thumbnail fetch or parse failed)',
              ai_tagged_at: new Date().toISOString(),
            }).eq('creative_id', row.creative_id);
            failed += 1;
            continue;
          }

          const tags = insightsToTags(insights);
          await db.from('dim_creatives').update({
            ai_tags: tags,
            ai_insights: insights,
            ai_tag_status: 'completed',
            ai_tag_error: null,
            ai_tagged_at: new Date().toISOString(),
          }).eq('creative_id', row.creative_id);
          succeeded += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await db.from('dim_creatives').update({
            ai_tag_status: 'failed',
            ai_tag_error: msg.slice(0, 500),
            ai_tagged_at: new Date().toISOString(),
          }).eq('creative_id', row.creative_id);
          failed += 1;
        }
      }

      // Policz ile pending zostało
      const { count: remaining } = await db
        .from('dim_creatives')
        .select('*', { count: 'exact', head: true })
        .eq('ai_tag_status', 'pending');

      if (etlLogId) {
        await db.from('etl_log').update({
          status: 'success',
          finished_at: new Date().toISOString(),
          rows_processed: rows.length,
          rows_inserted: succeeded,
          error_message: `succeeded=${succeeded} failed=${failed} remaining=${remaining ?? 0}`,
        }).eq('id', etlLogId);
      }

      return NextResponse.json({
        processed: rows.length,
        succeeded,
        failed,
        remaining: remaining ?? 0,
      });
    } catch (err) {
      if (etlLogId) {
        await db.from('etl_log').update({
          status: 'error',
          error_message: String(err),
          finished_at: new Date().toISOString(),
        }).eq('id', etlLogId);
      }
      throw err;
    }
  } catch (err) {
    console.error('Creative tagging error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
