/**
 * Metadane modeli generacji — bezpieczne dla klienta (bez kluczy API).
 * Identyfikatory API modeli można nadpisać env varami (patrz providers/index.ts),
 * bo dostawcy zmieniają nazwy modeli.
 */

export type StudioModelId = 'nano-banana-pro' | 'nano-banana-2' | 'gpt-image-2';

export interface StudioModelMeta {
  id: StudioModelId;
  label: string;
  vendor: 'Google' | 'OpenAI';
  description: string;
  whenToUse: string;
  supportsNativeMask: boolean;
  supportsReferenceImages: boolean;
  estimatedSeconds: number;
}

export const STUDIO_MODELS: StudioModelMeta[] = [
  {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    vendor: 'Google',
    description: 'Najlepszy fotorealizm materiałów i tkanin, wysoka rozdzielczość, wiele obrazów referencyjnych w jednym wywołaniu.',
    whenToUse: 'Do finalnych wizualizacji.',
    supportsNativeMask: false,
    supportsReferenceImages: true,
    estimatedSeconds: 50,
  },
  {
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
    vendor: 'Google',
    description: 'Szybki i tani. Dobra jakość przy krótkim czasie oczekiwania.',
    whenToUse: 'Do szkiców, draftów i szybkich iteracji.',
    supportsNativeMask: false,
    supportsReferenceImages: true,
    estimatedSeconds: 15,
  },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    vendor: 'OpenAI',
    description: 'Jedyny z natywnym maskowaniem — edytuje wyłącznie zaznaczony pędzlem obszar, reszta zostaje nietknięta.',
    whenToUse: 'Do chirurgicznych poprawek zaznaczonych obszarów.',
    supportsNativeMask: true,
    supportsReferenceImages: true,
    estimatedSeconds: 40,
  },
];

export const DEFAULT_GENERATION_MODEL: StudioModelId = 'nano-banana-pro';
export const DEFAULT_EDIT_MODEL: StudioModelId = 'gpt-image-2';

export function isStudioModelId(v: string): v is StudioModelId {
  return STUDIO_MODELS.some((m) => m.id === v);
}
