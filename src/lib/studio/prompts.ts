/**
 * Budowa promptów do generacji wizualizacji produktowych.
 * Do modeli wysyłamy wersje angielskie (lepsze wyniki), wersje polskie
 * służą dokumentacji i podglądowi w UI.
 */

/**
 * ŻELAZNA ZASADA — ochrona produktu. Packshot mebla jest nienaruszalny.
 */
export const PRODUCT_LOCK_PROMPT_PL = `Packshot mebla jest nienaruszalny — zachowaj identyczną bryłę, proporcje, konstrukcję, kolor tapicerki, materiał, szwy, nóżki i wszystkie detale produktu. Zmieniaj WYŁĄCZNIE otoczenie: pomieszczenie, tło, oświetlenie, dekoracje, dodatki.`;

export const PRODUCT_LOCK_PROMPT_EN = `IRON RULE — PRODUCT INTEGRITY: The furniture product shown in the first reference image (the packshot) is untouchable. Reproduce it EXACTLY: identical shape, proportions, construction, upholstery color, fabric and material texture, stitching, seams, legs, and every product detail. Do NOT restyle, recolor, reshape, redesign or "improve" the product in any way. You may ONLY change the surroundings: the room, background, lighting, decorations and accessories. The product must remain photographically faithful to the packshot.`;

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
      'Strongly reproduce the style of the attached inspiration images: their palette, materials, furniture styling, decor density, lighting and mood. The generated interior should look like it belongs to the same interior-design project as the inspirations.',
  },
  5: {
    level: 5,
    labelPl: 'Odtwórz klimat referencji tak wiernie, jak się da',
    maxReferenceImages: 12,
    phraseEn:
      'Recreate the atmosphere of the attached inspiration images as faithfully as possible: palette, materials, textures, decor, window styles, lighting direction and mood. Short of copying them pixel by pixel, the result should feel like another photograph from the exact same styled interior series.',
  },
};

/** Maksymalna łączna liczba obrazów wejściowych dla Gemini (packshot + referencje). */
export const MAX_TOTAL_INPUT_IMAGES = 14;

export interface BuildPromptInput {
  roomName?: string | null;
  roomBasePrompt?: string | null;
  styleText?: string | null;
  inspirationStrength?: number | null;
  hasInspirationImages?: boolean;
  manualNotes?: string | null;
}

/**
 * Składa pełny prompt generacji: ochrona produktu → scena → styl →
 * instrukcja inspiracji → uwagi ręczne.
 */
export function buildGenerationPrompt(input: BuildPromptInput): string {
  const parts: string[] = [PRODUCT_LOCK_PROMPT_EN];

  parts.push(
    'TASK: Place the product from the packshot (first image) in a photorealistic interior scene described below. Professional interior photography, realistic perspective, natural shadows and reflections consistent with the scene lighting, high-end furniture catalog quality.'
  );

  if (input.roomBasePrompt) {
    const roomLabel = input.roomName ? ` (${input.roomName})` : '';
    parts.push(`SCENE${roomLabel}: ${input.roomBasePrompt}`);
  }

  if (input.styleText?.trim()) {
    parts.push(`STYLE DIRECTION: ${input.styleText.trim()}`);
  }

  if (input.hasInspirationImages && input.inspirationStrength) {
    const level = INSPIRATION_STRENGTH_LEVELS[input.inspirationStrength];
    if (level) parts.push(`INSPIRATION REFERENCES: ${level.phraseEn}`);
  }

  if (input.manualNotes?.trim()) {
    parts.push(`ADDITIONAL NOTES FROM THE ART DIRECTOR: ${input.manualNotes.trim()}`);
  }

  return parts.join('\n\n');
}

/**
 * Prompt edycji dla modeli Gemini (technika adnotacji — bez natywnej maski):
 * wysyłamy oryginał + kopię z czerwoną półprzezroczystą maską.
 */
export function buildGeminiAnnotatedEditPrompt(instruction: string): string {
  return [
    'You receive two images: (1) the ORIGINAL image, and (2) an ANNOTATED copy of the same image where a region is marked with a semi-transparent red overlay.',
    `Edit ONLY the region marked in red on the annotated image. Apply this change: ${instruction.trim()}.`,
    'Keep everything outside the marked region pixel-identical to the ORIGINAL image. Return the full edited image at the same resolution, without any red markings.',
  ].join('\n');
}

/**
 * Prompt edycji dla GPT Image (natywna maska — obszar przezroczysty = do edycji).
 */
export function buildOpenAiMaskEditPrompt(instruction: string): string {
  return [
    `Apply this change inside the masked (editable) region: ${instruction.trim()}.`,
    'Blend the edit naturally with the surrounding image: match lighting, perspective, grain and color grading. Everything outside the mask must remain unchanged.',
  ].join('\n');
}
