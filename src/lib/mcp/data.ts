import type { SupabaseClient } from '@supabase/supabase-js';
import { AD_ROW_COLUMNS, type AdRow } from './metrics';
import { badRequest } from '@/lib/hub/core';

// Dostęp do danych dla narzędzi MCP. Wszystkie zapytania stronicują po 1000
// (limit PostgREST) i sortują po pełnym kluczu, żeby kolejne strony nie gubiły
// ani nie powtarzały wierszy.

const PAGE = 1000;
export const THUMB_BUCKET = 'creative-thumbs';
const MAX_ROWS = 200_000;

export async function fetchAdRows(
  db: SupabaseClient,
  opts: { accountIds: string[]; from: string; to: string; adIds?: string[]; creativeId?: string },
): Promise<AdRow[]> {
  if (opts.accountIds.length === 0) return [];
  const rows: AdRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    let q = db
      .from('fact_daily_ad_performance')
      .select(AD_ROW_COLUMNS)
      .eq('platform', 'meta')
      .in('account_id', opts.accountIds)
      .gte('date', opts.from)
      .lte('date', opts.to)
      .order('date', { ascending: true })
      .order('ad_id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (opts.adIds) q = q.in('ad_id', opts.adIds);
    if (opts.creativeId) q = q.eq('creative_id', opts.creativeId);
    const { data, error } = await q;
    if (error) throw new Error(`fact_daily_ad_performance: ${error.message}`);
    const page = (data || []) as unknown as AdRow[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
  throw badRequest(`Za dużo wierszy (>${MAX_ROWS}) — zawęź zakres dat albo sklep.`);
}

/** Ostatni dzień z danymi dla podanych kont (null, gdy brak). */
export async function latestDataDate(db: SupabaseClient, accountIds: string[]): Promise<string | null> {
  if (accountIds.length === 0) return null;
  const { data, error } = await db
    .from('fact_daily_ad_performance')
    .select('date')
    .eq('platform', 'meta')
    .in('account_id', accountIds)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`fact_daily_ad_performance: ${error.message}`);
  return (data?.date as string) ?? null;
}

export interface CreativeRow {
  creative_id: string;
  account_id: string;
  title: string | null;
  body: string | null;
  call_to_action_type: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  video_id: string | null;
  permalink_url: string | null;
  format: string | null;
  aspect_ratio: string | null;
  duration_sec: number | null;
  auto_tags: string[] | null;
  ai_tags: string[] | null;
  ai_tag_status: string | null;
  ai_insights: Record<string, unknown> | null;
  manual_tags: string[] | null;
  manual_notes: string | null;
  is_dynamic: boolean | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  thumb_storage_path: string | null;
  image_storage_path: string | null;
}

const CREATIVE_COLUMNS = [
  'creative_id', 'account_id', 'title', 'body', 'call_to_action_type', 'thumbnail_url', 'image_url',
  'video_id', 'permalink_url', 'format', 'aspect_ratio', 'duration_sec', 'auto_tags', 'ai_tags',
  'ai_tag_status', 'ai_insights', 'manual_tags', 'manual_notes', 'is_dynamic', 'first_seen_at',
  'last_seen_at', 'thumb_storage_path', 'image_storage_path',
].join(',');

export async function fetchCreatives(db: SupabaseClient, ids: string[]): Promise<Map<string, CreativeRow>> {
  const out = new Map<string, CreativeRow>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const { data, error } = await db.from('dim_creatives').select(CREATIVE_COLUMNS).in('creative_id', chunk);
    if (error) throw new Error(`dim_creatives: ${error.message}`);
    for (const c of (data || []) as unknown as CreativeRow[]) out.set(c.creative_id, c);
  }
  return out;
}

export interface ThumbnailInfo {
  url: string | null;
  /** storage = nasza kopia (stały link); meta_cdn = podpisany link fbcdn, wygasa. */
  source: 'storage' | 'meta_cdn' | null;
}

export function thumbnailFor(db: SupabaseClient, c: Pick<CreativeRow, 'thumb_storage_path' | 'thumbnail_url'> | undefined): ThumbnailInfo {
  if (!c) return { url: null, source: null };
  if (c.thumb_storage_path) {
    return { url: db.storage.from(THUMB_BUCKET).getPublicUrl(c.thumb_storage_path).data.publicUrl, source: 'storage' };
  }
  if (c.thumbnail_url) return { url: c.thumbnail_url, source: 'meta_cdn' };
  return { url: null, source: null };
}

export function imageFor(db: SupabaseClient, c: Pick<CreativeRow, 'image_storage_path' | 'image_url'>): string | null {
  if (c.image_storage_path) return db.storage.from(THUMB_BUCKET).getPublicUrl(c.image_storage_path).data.publicUrl;
  return c.image_url;
}

/** Wszystkie tagi kreacji (auto + AI + ręczne), bez duplikatów. */
export function allTags(c: Pick<CreativeRow, 'auto_tags' | 'ai_tags' | 'manual_tags'>): string[] {
  return [...new Set([...(c.auto_tags || []), ...(c.ai_tags || []), ...(c.manual_tags || [])])];
}
