import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function getUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
}

function getAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
}

function getServiceKey() {
  return process.env.SUPABASE_SERVICE_KEY || '';
}

let _supabase: SupabaseClient | null = null;
let _supabaseAdmin: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = getUrl();
    const key = getAnonKey();
    if (!url || !key) {
      throw new Error('Supabase URL and anon key are required. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const url = getUrl();
    const serviceKey = getServiceKey();
    const anonKey = getAnonKey();
    const key = serviceKey || anonKey;
    if (!url || !key) {
      throw new Error('Supabase URL and key are required. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY.');
    }
    _supabaseAdmin = createClient(url, key);
  }
  return _supabaseAdmin;
}

// Lazy proxies that properly bind methods to the real client instance
function createLazyProxy(getter: () => SupabaseClient): SupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Proxy({} as any, {
    get(_, prop) {
      const target = getter();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value = (target as any)[prop];
      // Bind functions to the real client so `this` context is correct
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}

export const supabase: SupabaseClient = createLazyProxy(getSupabase);
export const supabaseAdmin: SupabaseClient = createLazyProxy(getSupabaseAdmin);
