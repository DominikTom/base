import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * Health check — tests Supabase connectivity and env var configuration.
 * Hit /api/health to diagnose issues.
 */
export async function GET() {
  const checks: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    env: {
      SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL ? 'set' : 'MISSING',
      SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'set' : 'MISSING',
      SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY ? 'set' : 'MISSING',
    },
  };

  // Test Supabase connection
  try {
    const db = getSupabaseAdmin();
    checks.supabase_client = 'created';

    // Try a simple query
    const { data, error } = await db.from('etl_log').select('id').limit(1);
    if (error) {
      checks.supabase_query = { error: error.message, code: error.code, hint: error.hint };
    } else {
      checks.supabase_query = { success: true, rows: data?.length ?? 0 };
    }
  } catch (err) {
    checks.supabase_client = { error: String(err) };
  }

  const allOk = checks.supabase_client === 'created'
    && typeof checks.supabase_query === 'object'
    && (checks.supabase_query as Record<string, unknown>).success === true;

  return NextResponse.json(
    { status: allOk ? 'ok' : 'error', checks },
    { status: allOk ? 200 : 500 }
  );
}
