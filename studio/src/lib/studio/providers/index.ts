import { getModelMeta, type StudioModelId } from '../models';
import { GeminiImageProvider } from './gemini';
import { OpenAiImageProvider } from './openai';
import type { ImageProvider } from './types';

export * from './types';

/**
 * Zwraca provider dla wybranego modelu. Rejestr jest data-driven
 * (src/lib/studio/models.ts): dodanie kolejnego modelu = jeden wpis tam;
 * identyfikator API można nadpisać env varem z pola envVar.
 */
export function getImageProvider(modelId: StudioModelId): ImageProvider {
  const meta = getModelMeta(modelId);
  if (!meta) throw new Error(`Nieznany model: ${modelId}`);
  const apiModel = process.env[meta.envVar] || meta.apiModelDefault;
  return meta.provider === 'gemini'
    ? new GeminiImageProvider(apiModel)
    : new OpenAiImageProvider(apiModel);
}
