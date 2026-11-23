import type { SupabaseClient } from '@supabase/supabase-js';

export type StudioBucket = 'packshots' | 'inspirations' | 'generations';

export {
  ALLOWED_IMAGE_TYPES,
  extForMime,
  MAX_UPLOAD_BYTES,
} from './upload-limits';

/**
 * Adres pliku serwowany przez nasz same-origin proxy (autoryzacja sesją + RLS).
 * `width` włącza miniaturę (transformacja obrazu po stronie Supabase) —
 * używać w siatkach, pełna rozdzielczość tylko w podglądzie/pobieraniu.
 */
export function studioFileUrl(bucket: StudioBucket, path: string, width?: number): string {
  const w = width ? `&w=${width}` : '';
  return `/api/studio/file?b=${bucket}&p=${encodeURIComponent(path)}${w}`;
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
