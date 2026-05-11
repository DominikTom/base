import { getSupabaseAdmin } from '@/lib/supabase';

// Daily cron does ~2 calls per active sensor; this is a safety cap against runaway loops.
const MAX_REQUESTS_PER_WINDOW = 100;
const WINDOW_MS = 10 * 60 * 1000;

export async function canFetchHistoricalData(): Promise<boolean> {
  const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count, error } = await getSupabaseAdmin()
    .from('sensmax_sync_log')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'historical')
    .eq('status', 'ok')
    .gte('created_at', sinceIso);

  if (error) throw error;
  return (count ?? 0) < MAX_REQUESTS_PER_WINDOW;
}
