/**
 * Rejestr modeli generacji — bezpieczny dla klienta (bez kluczy API).
 * Identyfikatory API są nadpisywalne env varami (envVar), bo dostawcy
 * zmieniają nazwy. Zweryfikowane 2026-11: gemini-3-pro-image,
 * gemini-nano-banana-2.1, gemini-3.1-flash-image, gpt-image-2.6-{sunburst,flare},
 * gpt-image-2.5-{sunburst,flare}, gpt-image-2.
 */

export type StudioModelId =
  | 'nano-banana-pro'
  | 'nano-banana-2.1'
  | 'nano-banana-2'
  | 'gpt-image-2.6-sunburst'
  | 'gpt-image-2.6-flare'
  | 'gpt-image-2.5-sunburst'
  | 'gpt-image-2.5-flare'
  | 'gpt-image-2';

export interface StudioModelMeta {
  id: StudioModelId;
  label: string;
  vendor: 'Google' | 'OpenAI';
  provider: 'gemini' | 'openai';
  /** Domyślny identyfikator w API dostawcy (nadpisywalny env varem envVar). */
  apiModelDefault: string;
  /** Nazwa zmiennej środowiskowej nadpisującej identyfikator API. */
  envVar: string;
  description: string;
  whenToUse: string;
  supportsNativeMask: boolean;
  supportsReferenceImages: boolean;
  /** Obsługa rozdzielczości 2K/4K (imageConfig.imageSize linii Gemini Pro). */
  supports4K: boolean;
  estimatedSeconds: number;
  /** Starsze modele — nadal działają, ale nie promujemy ich w UI. */
  legacy?: boolean;
}

export const STUDIO_MODELS: StudioModelMeta[] = [
  {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    vendor: 'Google',
    provider: 'gemini',
    apiModelDefault: 'gemini-3-pro-image',
    envVar: 'GEMINI_PRO_IMAGE_MODEL',
    description: 'Najwyższy fotorealizm materiałów i tkanin, wiele referencji, jedyny z 4K.',
    whenToUse: 'Do finalnych wizualizacji.',
    supportsNativeMask: false,
    supportsReferenceImages: true,
    supports4K: true,
    estimatedSeconds: 50,
  },
  {
    id: 'nano-banana-2.1',
    label: 'Nano Banana 2.1',
    vendor: 'Google',
    provider: 'gemini',
    apiModelDefault: 'gemini-nano-banana-2.1',
    envVar: 'GEMINI_NB21_IMAGE_MODEL',
    description: 'Nowy (X 2026): jakość blisko Pro przy szybkości Flash, lepsza spójność i trzymanie promptu.',
    whenToUse: 'Nowy domyślny do szybkich, dobrych iteracji.',
    supportsNativeMask: false,
    supportsReferenceImages: true,
    supports4K: false,
    estimatedSeconds: 20,
  },
  {
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
    vendor: 'Google',
    provider: 'gemini',
    apiModelDefault: 'gemini-3.1-flash-image',
    envVar: 'GEMINI_FLASH_IMAGE_MODEL',
    description: 'Szybki i tani poprzednik 2.1.',
    whenToUse: 'Do najtańszych szkiców.',
    supportsNativeMask: false,
    supportsReferenceImages: true,
    supports4K: false,
    estimatedSeconds: 15,
    legacy: true,
  },
  {
    id: 'gpt-image-2.6-sunburst',
    label: 'GPT Image 2.6 Sunburst',
    vendor: 'OpenAI',
    provider: 'openai',
    apiModelDefault: 'gpt-image-2.6-sunburst',
    envVar: 'OPENAI_IMAGE_26_SUNBURST_MODEL',
    description: 'Nowy (XI 2026): najwyższa precyzja edycji z natywną maską.',
    whenToUse: 'Nowy domyślny do poprawek pędzlem.',
    supportsNativeMask: true,
    supportsReferenceImages: true,
    supports4K: false,
    estimatedSeconds: 40,
  },
  {
    id: 'gpt-image-2.6-flare',
    label: 'GPT Image 2.6 Flare',
    vendor: 'OpenAI',
    provider: 'openai',
    apiModelDefault: 'gpt-image-2.6-flare',
    envVar: 'OPENAI_IMAGE_26_FLARE_MODEL',
    description: 'Nowy (XI 2026): szybka generacja OpenAI, niższa latencja.',
    whenToUse: 'Szybkie iteracje w stylistyce OpenAI.',
    supportsNativeMask: true,
    supportsReferenceImages: true,
    supports4K: false,
    estimatedSeconds: 25,
  },
  {
    id: 'gpt-image-2.5-sunburst',
    label: 'GPT Image 2.5 Sunburst',
    vendor: 'OpenAI',
    provider: 'openai',
    apiModelDefault: 'gpt-image-2.5-sunburst',
    envVar: 'OPENAI_IMAGE_25_SUNBURST_MODEL',
    description: 'Precyzyjne edycje z maską (IX 2026).',
    whenToUse: 'Alternatywa dla 2.6 Sunburst.',
    supportsNativeMask: true,
    supportsReferenceImages: true,
    supports4K: false,
    estimatedSeconds: 40,
    legacy: true,
  },
  {
    id: 'gpt-image-2.5-flare',
    label: 'GPT Image 2.5 Flare',
    vendor: 'OpenAI',
    provider: 'openai',
    apiModelDefault: 'gpt-image-2.5-flare',
    envVar: 'OPENAI_IMAGE_25_FLARE_MODEL',
    description: 'Szybka generacja (IX 2026).',
    whenToUse: 'Alternatywa dla 2.6 Flare.',
    supportsNativeMask: true,
    supportsReferenceImages: true,
    supports4K: false,
    estimatedSeconds: 25,
    legacy: true,
  },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    vendor: 'OpenAI',
    provider: 'openai',
    apiModelDefault: 'gpt-image-2',
    envVar: 'OPENAI_IMAGE_MODEL',
    description: 'Starszy model edycji z maską.',
    whenToUse: 'Tylko dla porównań ze starszymi wynikami.',
    supportsNativeMask: true,
    supportsReferenceImages: true,
    supports4K: false,
    estimatedSeconds: 40,
    legacy: true,
  },
];

export const DEFAULT_GENERATION_MODEL: StudioModelId = 'nano-banana-pro';
export const DEFAULT_EDIT_MODEL: StudioModelId = 'gpt-image-2.6-sunburst';

export function getModelMeta(id: string): StudioModelMeta | undefined {
  return STUDIO_MODELS.find((m) => m.id === id);
}

export function isStudioModelId(v: string): v is StudioModelId {
  return STUDIO_MODELS.some((m) => m.id === v);
}
