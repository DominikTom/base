/**
 * Budowa promptów do generacji wizualizacji produktowych.
 * Do modeli wysyłamy wersje angielskie (lepsze wyniki), wersje polskie
 * służą dokumentacji i podglądowi w UI.
 */

/**
 * ŻELAZNA ZASADA — ochrona produktu. Packshot mebla jest nienaruszalny.
 */
export const PRODUCT_LOCK_PROMPT_PL = `Packshoty mebli są nienaruszalne — zachowaj identyczną bryłę, proporcje, konstrukcję, kolor tapicerki, materiał, szwy, nóżki i wszystkie detale każdego produktu. Zmieniaj WYŁĄCZNIE otoczenie: pomieszczenie, tło, oświetlenie, dekoracje, dodatki.`;

export const PRODUCT_LOCK_PROMPT_EN = `IRON RULE — PRODUCT INTEGRITY: The furniture products shown in the packshot images are untouchable. Reproduce every one of them EXACTLY: identical shape, proportions, construction, upholstery color, fabric and material texture, stitching, seams, legs, and every product detail. Do NOT restyle, recolor, reshape, redesign or "improve" any product in any way. You may ONLY change the surroundings: the room, background, lighting, decorations and accessories. Each product must remain photographically faithful to its packshot.`;

/**
 * Siła inspiracji 1–5. Każdy poziom to przetestowana fraza + limit obrazów
 * referencyjnych. Gemini przyjmuje do ~14 obrazów wejściowych łącznie,
 * packshot ma zawsze priorytet (idzie pierwszy).
 */
export interface InspirationStrengthLevel {
  level: 1 | 2 | 3 | 4 | 5;
  labelPl: string;
  maxReferenceImages: number;
  phraseEn: string;
}

export const INSPIRATION_STRENGTH_LEVELS: Record<number, InspirationStrengthLevel> = {
  1: {
    level: 1,
    labelPl: 'Subtelna sugestia kolorystyki',
    maxReferenceImages: 1,
    phraseEn:
      'Treat the attached inspiration image only as a subtle hint of the color palette. Borrow no more than a gentle suggestion of its dominant colors; compose the room independently.',
  },
  2: {
    level: 2,
    labelPl: 'Paleta i materiały',
    maxReferenceImages: 2,
    phraseEn:
      'Use the attached inspiration images as guidance for the color palette and the main materials (wood tones, textiles, metals). The overall composition and layout remain your own.',
  },
  3: {
    level: 3,
    labelPl: 'Paleta, materiały i nastrój',
    maxReferenceImages: 3,
    phraseEn:
      'Follow the attached inspiration images for color palette, materials and overall mood (lighting character, atmosphere). Aim for a room that clearly feels related to the inspirations while remaining an original composition.',
  },
  4: {
    level: 4,
    labelPl: 'Mocne odwzorowanie stylu',
    maxReferenceImages: 6,
    phraseEn:
      'Strongly reproduce the style of the inspiration images: their palette, wall/floor materials, decor styling and density, lighting and mood. The generated interior should look like it belongs to the same interior-design project as the inspirations.',
  },
  5: {
    level: 5,
    labelPl: 'Odtwórz klimat referencji tak wiernie, jak się da',
    maxReferenceImages: 12,
    phraseEn:
      'Recreate the atmosphere of the inspiration images as faithfully as possible: palette, room materials, textures, decor, window styles, lighting direction and mood. Short of copying them pixel by pixel, the result should feel like another photograph from the exact same styled interior series — with the packshot product(s) placed in it unchanged.',
  },
};

/** Maksymalna łączna liczba obrazów wejściowych dla Gemini (packshot + referencje). */
export const MAX_TOTAL_INPUT_IMAGES = 14;

export interface BuildPromptInput {
  roomName?: string | null;
  roomBasePrompt?: string | null;
  styleText?: string | null;
  inspirationStrength?: number | null;
  /** Faktyczna liczba obrazów w wybranym zestawie inspiracji. */
  inspirationImageCount?: number;
  manualNotes?: string | null;
  /** Liczba packshotów głównych (bohaterowie sceny). */
  mainCount?: number;
  /** Liczba packshotów-dodatków (produkty uzupełniające). */
  additionCount?: number;
}

/** Ile obrazów referencyjnych faktycznie trafi do modelu przy danych parametrach. */
export function effectiveReferenceCount(
  strength: number | null | undefined,
  inspirationImageCount: number,
  packshotCount: number
): number {
  if (!strength) return 0;
  const level = INSPIRATION_STRENGTH_LEVELS[strength];
  if (!level) return 0;
  return Math.max(
    0,
    Math.min(level.maxReferenceImages, inspirationImageCount, MAX_TOTAL_INPUT_IMAGES - packshotCount)
  );
}

/**
 * Składa pełny prompt generacji: ochrona produktów → role packshotów →
 * scena → styl → instrukcja inspiracji → uwagi ręczne.
 */
export function buildGenerationPrompt(input: BuildPromptInput): string {
  const parts: string[] = [PRODUCT_LOCK_PROMPT_EN];

  const mains = Math.max(1, input.mainCount ?? 1);
  const additions = Math.max(0, input.additionCount ?? 0);
  const packshotCount = mains + additions;
  const refCount = effectiveReferenceCount(
    input.inspirationStrength,
    input.inspirationImageCount ?? 0,
    packshotCount
  );
  const totalImages = packshotCount + refCount;

  // Jawna mapa obrazów wejściowych — model musi wiedzieć, który obraz jest
  // packshotem, a który tylko referencją stylu (inaczej miesza cechy mebli
  // z inspiracji z produktem).
  const mapLines: string[] = [`INPUT IMAGES (${totalImages} total):`];
  if (packshotCount === 1) {
    mapLines.push('- Image 1: PRODUCT PACKSHOT (the main product).');
  } else if (additions === 0) {
    mapLines.push(`- Images 1–${mains}: PRODUCT PACKSHOTS — all MAIN products (a matching furniture collection).`);
  } else {
    mapLines.push(
      mains === 1
        ? '- Image 1: PRODUCT PACKSHOT — the MAIN product (hero of the scene).'
        : `- Images 1–${mains}: PRODUCT PACKSHOTS — MAIN products (co-heroes of the scene).`
    );
    mapLines.push(
      additions === 1
        ? `- Image ${mains + 1}: PRODUCT PACKSHOT — a SUPPORTING product (complementary, less prominent).`
        : `- Images ${mains + 1}–${packshotCount}: PRODUCT PACKSHOTS — SUPPORTING products (complementary, less prominent).`
    );
  }
  if (refCount > 0) {
    mapLines.push(
      `- ${refCount === 1 ? `Image ${totalImages}` : `Images ${packshotCount + 1}–${totalImages}`}: STYLE INSPIRATION references — they describe the ROOM ONLY (palette, wall/floor materials, decor, lighting, mood). NEVER place furniture from these images into the scene as products and NEVER transfer their shapes, fabrics or details onto the packshot products.`
    );
  }
  parts.push(mapLines.join('\n'));

  const arrangeLine =
    packshotCount === 1
      ? 'Place the product from the packshot in a photorealistic interior scene described below.'
      : `Arrange ALL ${packshotCount} packshot products together in ONE photorealistic interior scene described below, with consistent scale between products.`;
  parts.push(
    `TASK: ${arrangeLine} Professional interior photography, realistic perspective, natural shadows and reflections consistent with the scene lighting, high-end furniture catalog quality. Render every packshot product tack-sharp, at the same level of detail and texture crispness as its packshot — do not soften, blur, repaint or simplify the product's fabric, pattern or edges.`
  );

  if (input.roomBasePrompt) {
    const roomLabel = input.roomName ? ` (${input.roomName})` : '';
    parts.push(`SCENE${roomLabel}: ${input.roomBasePrompt}`);
  }

  if (input.styleText?.trim()) {
    parts.push(`STYLE DIRECTION: ${input.styleText.trim()}`);
  }

  if (refCount > 0 && input.inspirationStrength) {
    const level = INSPIRATION_STRENGTH_LEVELS[input.inspirationStrength];
    if (level) {
      parts.push(
        `INSPIRATION REFERENCES: ${level.phraseEn} The inspirations apply to the room and decor only — the packshot products themselves stay exactly as in their packshots.`
      );
    }
  }

  if (input.manualNotes?.trim()) {
    parts.push(`ADDITIONAL NOTES FROM THE ART DIRECTOR: ${input.manualNotes.trim()}`);
  }

  return parts.join('\n\n');
}

/** Domyślna instrukcja, gdy user dał tylko obrazy referencyjne bez opisu. */
export const DEFAULT_REFERENCE_EDIT_INSTRUCTION_EN =
  'Replace the content of the marked region with the product(s) from the attached reference image(s)';

function editChangeLine(instruction: string, referenceCount: number): string {
  const change = instruction.trim() || DEFAULT_REFERENCE_EDIT_INSTRUCTION_EN;
  if (referenceCount === 0) return `Apply this change: ${change}.`;
  return [
    `Apply this change: ${change}.`,
    `You also receive ${referenceCount === 1 ? 'one PRODUCT REFERENCE image' : `${referenceCount} PRODUCT REFERENCE images`} — ${referenceCount === 1 ? 'it shows' : 'they show'} the exact product(s) to place inside the edited region. Reproduce the reference product(s) faithfully: identical shape, proportions, colors, materials and details, adjusted only in perspective, scale and lighting to fit the scene naturally.`,
  ].join(' ');
}

/**
 * Prompt edycji dla modeli Gemini (technika adnotacji — bez natywnej maski):
 * wysyłamy oryginał + kopię z czerwoną półprzezroczystą maską (+ referencje).
 */
export function buildGeminiAnnotatedEditPrompt(instruction: string, referenceCount = 0): string {
  const imageList =
    referenceCount > 0
      ? `You receive images in this order: (1) the ORIGINAL image, (2) an ANNOTATED copy of the same image where a region is marked with a semi-transparent red overlay, ${referenceCount === 1 ? '(3) a PRODUCT REFERENCE image' : `(3+) ${referenceCount} PRODUCT REFERENCE images`}.`
      : 'You receive two images: (1) the ORIGINAL image, and (2) an ANNOTATED copy of the same image where a region is marked with a semi-transparent red overlay.';
  return [
    imageList,
    `Edit ONLY the region marked in red on the annotated image. ${editChangeLine(instruction, referenceCount)}`,
    'Keep everything outside the marked region pixel-identical to the ORIGINAL image. Return the full edited image at the same resolution, without any red markings.',
  ].join('\n');
}

/**
 * Prompt edycji dla GPT Image (natywna maska — obszar przezroczysty = do edycji;
 * dodatkowe obrazy w image[] służą jako referencje produktów).
 */
export function buildOpenAiMaskEditPrompt(instruction: string, referenceCount = 0): string {
  return [
    `${editChangeLine(instruction, referenceCount)}`,
    'Blend the edit naturally with the surrounding image: match lighting, perspective, grain and color grading. Everything outside the mask must remain unchanged.',
  ].join('\n');
}
