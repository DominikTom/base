import type { SupabaseClient } from '@supabase/supabase-js';
import { annotatedPathForMask } from './run-generation';
import { removeFromBucket } from './storage';

/** Trwałe usunięcie generacji wraz z plikami (wynik + maska + annotacja). */
export async function purgeGeneration(supabase: SupabaseClient, id: string): Promise<void> {
  const { data: gen } = await supabase
    .from('generations')
    .select('id, storage_path, mask_storage_path')
    .eq('id', id)
    .maybeSingle();
  if (!gen) return;
  const paths = [
    gen.storage_path,
    gen.mask_storage_path,
    gen.mask_storage_path ? annotatedPathForMask(gen.mask_storage_path) : null,
  ].filter((p): p is string => Boolean(p));
  await removeFromBucket(supabase, 'generations', paths);
  const { error } = await supabase.from('generations').delete().eq('id', id);
  if (error) throw new Error(`Nie udało się usunąć generacji: ${error.message}`);
}

export async function purgePackshot(supabase: SupabaseClient, id: string): Promise<void> {
  const { data: pk } = await supabase
    .from('packshots')
    .select('id, storage_path')
    .eq('id', id)
    .maybeSingle();
  if (!pk) return;
  await removeFromBucket(supabase, 'packshots', [pk.storage_path]);
  const { error } = await supabase.from('packshots').delete().eq('id', id);
  if (error) throw new Error(`Nie udało się usunąć packshota: ${error.message}`);
}

export async function purgeInspirationSet(supabase: SupabaseClient, id: string): Promise<void> {
  const { data: images } = await supabase
    .from('inspiration_images')
    .select('storage_path')
    .eq('set_id', id);
  await removeFromBucket(
    supabase,
    'inspirations',
    (images ?? []).map((i) => i.storage_path)
  );
  const { error } = await supabase.from('inspiration_sets').delete().eq('id', id);
  if (error) throw new Error(`Nie udało się usunąć zestawu: ${error.message}`);
}

/**
 * Czyści kosz: elementy soft-deleted starsze niż `olderThanDays` dni.
 * Kolejność: generacje → packshoty → zestawy (FK ustawione na SET NULL/CASCADE,
 * ale pliki musimy usunąć sami).
 */
export async function purgeExpired(
  supabase: SupabaseClient,
  olderThanDays = 30
): Promise<{ generations: number; packshots: number; sets: number }> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const counts = { generations: 0, packshots: 0, sets: 0 };

  const { data: gens } = await supabase
    .from('generations')
    .select('id')
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoff);
  for (const g of gens ?? []) {
    await purgeGeneration(supabase, g.id);
    counts.generations++;
  }

  const { data: packs } = await supabase
    .from('packshots')
    .select('id')
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoff);
  for (const p of packs ?? []) {
    await purgePackshot(supabase, p.id);
    counts.packshots++;
  }

  const { data: sets } = await supabase
    .from('inspiration_sets')
    .select('id')
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoff);
  for (const s of sets ?? []) {
    await purgeInspirationSet(supabase, s.id);
    counts.sets++;
  }

  return counts;
}
