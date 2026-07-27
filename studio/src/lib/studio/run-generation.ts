import { imageSize } from 'image-size';
import type { SupabaseClient } from '@supabase/supabase-js';
import { providerErrorToPolish } from './errors';
import { isStudioModelId } from './models';
import {
  buildGeminiAnnotatedEditPrompt,
  buildOpenAiMaskEditPrompt,
  INSPIRATION_STRENGTH_LEVELS,
  MAX_TOTAL_INPUT_IMAGES,
} from './prompts';
import { getImageProvider, type ImageInput } from './providers';
import { downloadFromBucket, uploadToBucket } from './storage';
import type { GenerationRow, InspirationImageRow } from './types';

/** Ścieżka annotowanej kopii wyprowadzana ze ścieżki maski. */
export function annotatedPathForMask(maskPath: string): string {
  return maskPath.replace(/-mask\.png$/, '-annotated.png');
}

function detectDims(data: Buffer): { width: number | null; height: number | null } {
  try {
    const dim = imageSize(data);
    return { width: dim.width ?? null, height: dim.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

/**
 * Wykonuje generację/edycję dla rekordu w statusie pending: pobiera obrazy
 * źródłowe, woła provider, zapisuje wynik do bucketu `generations` i ustawia
 * status done/error. Zwraca zaktualizowany rekord.
 */
export async function runGeneration(
  supabase: SupabaseClient,
  generation: GenerationRow
): Promise<GenerationRow> {
  const startedAt = Date.now();

  try {
    if (!isStudioModelId(generation.model)) {
      throw new Error(`Nieznany model: ${generation.model}`);
    }
    const provider = getImageProvider(generation.model);

    let result: { data: Buffer; mimeType: string };

    if (generation.edit_instruction && generation.mask_storage_path) {
      // --- Edycja pędzlem ---
      const source = await loadEditSource(supabase, generation);
      const mask = await downloadFromBucket(supabase, 'generations', generation.mask_storage_path);
      const annotated = await downloadFromBucket(
        supabase,
        'generations',
        annotatedPathForMask(generation.mask_storage_path)
      );
      const references: ImageInput[] = [];
      for (const refPath of generation.edit_reference_paths ?? []) {
        references.push(await downloadFromBucket(supabase, 'generations', refPath));
      }
      const isOpenAi = generation.model === 'gpt-image-2';
      result = await provider.edit({
        prompt: isOpenAi
          ? buildOpenAiMaskEditPrompt(generation.edit_instruction, references.length)
          : buildGeminiAnnotatedEditPrompt(generation.edit_instruction, references.length),
        image: source,
        mask,
        annotated,
        references,
      });
    } else {
      // --- Generacja z packshotów (1–5, główne najpierw) ---
      const packshotImages = await loadGenerationPackshots(supabase, generation);
      if (packshotImages.length === 0) throw new Error('Brak packshota dla generacji.');

      const references = await loadInspirationReferences(supabase, generation, packshotImages.length);

      result = await provider.generate({
        prompt: generation.full_prompt_sent ?? '',
        packshot: packshotImages[0],
        references: [...packshotImages.slice(1), ...references],
        imageSize: generation.model === 'nano-banana-pro' ? '2K' : '1K',
      });
    }

    const outPath = `${generation.user_id}/${generation.id}.png`;
    await uploadToBucket(supabase, 'generations', outPath, result.data, result.mimeType);
    const dims = detectDims(result.data);

    const { data: updated, error: updErr } = await supabase
      .from('generations')
      .update({
        status: 'done',
        storage_path: outPath,
        width: dims.width,
        height: dims.height,
        duration_ms: Date.now() - startedAt,
        error_message: null,
      })
      .eq('id', generation.id)
      .select()
      .single();
    if (updErr) throw new Error(`Nie udało się zapisać wyniku: ${updErr.message}`);
    return updated as GenerationRow;
  } catch (err) {
    const message = providerErrorToPolish(err);
    const { data: updated } = await supabase
      .from('generations')
      .update({
        status: 'error',
        error_message: message,
        duration_ms: Date.now() - startedAt,
      })
      .eq('id', generation.id)
      .select()
      .single();
    return (updated as GenerationRow) ?? { ...generation, status: 'error', error_message: message };
  }
}

/** Źródło edycji: wynik rodzica albo surowy packshot. */
async function loadEditSource(
  supabase: SupabaseClient,
  generation: GenerationRow
): Promise<ImageInput> {
  if (generation.parent_generation_id) {
    const { data: parent } = await supabase
      .from('generations')
      .select('storage_path')
      .eq('id', generation.parent_generation_id)
      .single();
    if (!parent?.storage_path) throw new Error('Rodzic edycji nie ma zapisanego obrazu.');
    return downloadFromBucket(supabase, 'generations', parent.storage_path);
  }
  if (generation.packshot_id) {
    const { data: packshot } = await supabase
      .from('packshots')
      .select('storage_path')
      .eq('id', generation.packshot_id)
      .single();
    if (!packshot?.storage_path) throw new Error('Nie znaleziono packshota do edycji.');
    return downloadFromBucket(supabase, 'packshots', packshot.storage_path);
  }
  throw new Error('Edycja nie ma źródła (rodzic ani packshot).');
}

/**
 * Packshoty generacji w kolejności: główne → dodatki (wg sort_order).
 * Fallback do pojedynczego generations.packshot_id dla starych rekordów.
 */
async function loadGenerationPackshots(
  supabase: SupabaseClient,
  generation: GenerationRow
): Promise<ImageInput[]> {
  const { data: links } = await supabase
    .from('generation_packshots')
    .select('packshot_id, role, sort_order')
    .eq('generation_id', generation.id);

  let orderedIds: string[];
  if (links && links.length > 0) {
    orderedIds = [...links]
      .sort((a, b) =>
        a.role === b.role ? a.sort_order - b.sort_order : a.role === 'main' ? -1 : 1
      )
      .map((l) => l.packshot_id);
  } else if (generation.packshot_id) {
    orderedIds = [generation.packshot_id];
  } else {
    return [];
  }

  const { data: packshots } = await supabase
    .from('packshots')
    .select('id, storage_path')
    .in('id', orderedIds);
  const pathById = new Map((packshots ?? []).map((p) => [p.id, p.storage_path]));

  const images: ImageInput[] = [];
  for (const id of orderedIds) {
    const path = pathById.get(id);
    if (!path) throw new Error('Nie znaleziono jednego z packshotów generacji.');
    images.push(await downloadFromBucket(supabase, 'packshots', path));
  }
  return images;
}

/** Obrazy referencyjne z zestawu inspiracji, ograniczone siłą inspiracji. */
async function loadInspirationReferences(
  supabase: SupabaseClient,
  generation: GenerationRow,
  usedInputSlots: number
): Promise<ImageInput[]> {
  if (!generation.inspiration_set_id || !generation.inspiration_strength) return [];
  const level = INSPIRATION_STRENGTH_LEVELS[generation.inspiration_strength];
  if (!level) return [];

  const { data: images } = await supabase
    .from('inspiration_images')
    .select('*')
    .eq('set_id', generation.inspiration_set_id)
    .order('created_at', { ascending: true });

  const limit = Math.max(
    0,
    Math.min(level.maxReferenceImages, MAX_TOTAL_INPUT_IMAGES - usedInputSlots)
  );
  const picked = ((images ?? []) as InspirationImageRow[]).slice(0, limit);

  const results: ImageInput[] = [];
  for (const img of picked) {
    results.push(await downloadFromBucket(supabase, 'inspirations', img.storage_path));
  }
  return results;
}
