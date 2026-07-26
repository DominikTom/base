import type { SupabaseClient } from '@supabase/supabase-js';

export type StudioBucket = 'packshots' | 'inspirations' | 'generations';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function extForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

/** Adres pliku serwowany przez nasz same-origin proxy (autoryzacja sesją + RLS). */
export function studioFileUrl(bucket: StudioBucket, path: string): string {
  return `/api/studio/file?b=${bucket}&p=${encodeURIComponent(path)}`;
}

export async function uploadToBucket(
  supabase: SupabaseClient,
  bucket: StudioBucket,
  path: string,
  data: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  const { error } = await supabase.storage.from(bucket).upload(path, data, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`Upload do ${bucket}/${path} nie powiódł się: ${error.message}`);
}

export async function downloadFromBucket(
  supabase: SupabaseClient,
  bucket: StudioBucket,
  path: string
): Promise<{ data: Buffer; mimeType: string }> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    throw new Error(`Nie udało się pobrać ${bucket}/${path}: ${error?.message ?? 'brak danych'}`);
  }
  const buf = Buffer.from(await data.arrayBuffer());
  return { data: buf, mimeType: data.type || 'image/png' };
}

export async function removeFromBucket(
  supabase: SupabaseClient,
  bucket: StudioBucket,
  paths: string[]
): Promise<void> {
  if (paths.length === 0) return;
  await supabase.storage.from(bucket).remove(paths);
}
