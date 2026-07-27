'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient {
  if (!_client) {
    _client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _client;
}

/**
 * Upload pliku prosto z przeglądarki do Supabase Storage (sesja + RLS).
 * Omija limit 4,5 MB body na funkcjach serverless Vercela — do API wysyłamy
 * potem tylko ścieżkę pliku.
 */
export async function uploadToStorageFromBrowser(
  bucket: 'packshots' | 'inspirations' | 'generations',
  path: string,
  data: Blob,
  contentType: string
): Promise<void> {
  const supabase = getBrowserSupabase();
  const { error } = await supabase.storage.from(bucket).upload(path, data, {
    contentType,
    upsert: false,
  });
  if (error) {
    throw new Error(`Upload pliku nie powiódł się: ${error.message}`);
  }
}

export async function getBrowserUserId(): Promise<string> {
  const supabase = getBrowserSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Musisz być zalogowany.');
  return user.id;
}

/** Odczyt wymiarów obrazu po stronie przeglądarki. */
export function readImageDimensions(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Plik nie wygląda na poprawny obraz.'));
    };
    img.src = url;
  });
}
