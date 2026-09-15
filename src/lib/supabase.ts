import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;
let _supabaseAdmin: SupabaseClient | null = null;

/**
 * Client-side Supabase (anon key) — call this function, don't use at module level.
 */
export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
    if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    _supabase = createClient(url, key);
  }
  return _supabase;
}

/**
 * Server-side Supabase (service key) — call this function, don't use at module level.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    // No anon fallback. This client is what every server route writes through,
    // and silently degrading to the public key meant privileged writes only
    // worked because RLS was disabled on those tables — the fallback and the
    // missing RLS were propping each other up. A missing service key is a
    // deployment fault and must surface as one.
    const key = process.env.SUPABASE_SERVICE_KEY || '';
    if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    _supabaseAdmin = createClient(url, key);
  }
  return _supabaseAdmin;
}
