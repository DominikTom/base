import type { SupabaseClient } from '@supabase/supabase-js';

// Kopie miniatur i obrazów kreacji w Supabase Storage (bucket creative-thumbs,
// migracja 025). Linki fbcdn z Meta są podpisane i wygasają — po skopiowaniu
// dashboard, tagger AI i serwer MCP używają stałego URL-a z naszego Storage.

export const THUMB_BUCKET = 'creative-thumbs';
const MAX_BYTES = 10 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
};

/** Pobiera obraz z URL-a i zapisuje jako `<creative_id>/<kind>.<ext>`. Zwraca ścieżkę albo null. */
export async function storeCreativeImage(
  db: SupabaseClient,
  creativeId: string,
  url: string | null | undefined,
  kind: 'thumb' | 'image',
): Promise<string | null> {
  if (!url) return null;
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
  const ext = EXT_BY_TYPE[type];
  if (!ext) return null;
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return null;

  const safeId = creativeId.replace(/[^A-Za-z0-9_-]/g, '_');
  const path = `${safeId}/${kind}.${ext}`;
  const { error } = await db.storage.from(THUMB_BUCKET).upload(path, body, { contentType: type, upsert: true });
  if (error) {
    console.warn(`creative-thumbs upload ${path}: ${error.message}`);
    return null;
  }
  return path;
}

/** Kopiuje miniaturę i (dla statycznych) pełny obraz; zwraca pola do update na dim_creatives. */
export async function storeCreativeImages(
  db: SupabaseClient,
  creativeId: string,
  thumbnailUrl: string | null | undefined,
  imageUrl: string | null | undefined,
): Promise<Record<string, string>> {
  const [thumbPath, imagePath] = await Promise.all([
    storeCreativeImage(db, creativeId, thumbnailUrl, 'thumb'),
    imageUrl && imageUrl !== thumbnailUrl ? storeCreativeImage(db, creativeId, imageUrl, 'image') : Promise.resolve(null),
  ]);
  const patch: Record<string, string> = {};
  if (thumbPath) {
    patch.thumb_storage_path = thumbPath;
    patch.thumb_stored_at = new Date().toISOString();
  }
  if (imagePath) patch.image_storage_path = imagePath;
  return patch;
}

export function publicThumbUrl(db: SupabaseClient, path: string): string {
  return db.storage.from(THUMB_BUCKET).getPublicUrl(path).data.publicUrl;
}
