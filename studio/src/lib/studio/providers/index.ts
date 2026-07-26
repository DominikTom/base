import type { StudioModelId } from '../models';
import { GeminiImageProvider } from './gemini';
import { OpenAiImageProvider } from './openai';
import type { ImageProvider } from './types';

export * from './types';

/**
 * Identyfikatory API modeli — nadpisywalne env varami, bo dostawcy potrafią
 * zmieniać nazwy (np. sufiksy -preview). Zweryfikowane 2026-07:
 * gemini-3-pro-image, gemini-3.1-flash-image, gpt-image-2.
 */
function apiModelIds() {
  return {
    'nano-banana-pro': process.env.GEMINI_PRO_IMAGE_MODEL || 'gemini-3-pro-image',
    'nano-banana-2': process.env.GEMINI_FLASH_IMAGE_MODEL || 'gemini-3.1-flash-image',
    'gpt-image-2': process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
  } satisfies Record<StudioModelId, string>;
}

/**
 * Zwraca provider dla wybranego modelu. Dodanie kolejnego modelu (np. FLUX
 * Fill przez fal.ai) = nowa klasa implementująca ImageProvider + wpis tutaj
 * i w STUDIO_MODELS (models.ts).
 */
export function getImageProvider(modelId: StudioModelId): ImageProvider {
  const ids = apiModelIds();
  switch (modelId) {
    case 'nano-banana-pro':
      return new GeminiImageProvider(ids['nano-banana-pro']);
    case 'nano-banana-2':
      return new GeminiImageProvider(ids['nano-banana-2']);
    case 'gpt-image-2':
      return new OpenAiImageProvider(ids['gpt-image-2']);
  }
}
