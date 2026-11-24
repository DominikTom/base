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
  /** Liczba wariantów głównego produktu (ten sam mebel, inna konfiguracja). */
  variantCount?: number;
  /** Liczba packshotów-dodatków (produkty uzupełniające). */
  additionCount?: number;
  /**
   * Notatki per packshot ("gdzie ustawić, co na nim położyć"), w kolejności
   * obrazów wejściowych (główne, potem dodatki). Mogą być po polsku.
   */
  packshotNotes?: (string | null | undefined)[];
  /** Format kadru (np. '3:4') — wymuszany też na poziomie API modelu. */
  aspectRatio?: string | null;
  /** Ujęcie kamery (wide/medium/close); null/undefined = auto. */
  cameraShot?: string | null;
  /** Kąt kamery (front/three-quarter-…/side/low/elevated); null = auto. */
  cameraAngle?: string | null;
  /** Preset oświetlenia sceny; null = auto. */
  lighting?: string | null;
}

const CAMERA_SHOT_PHRASES: Record<string, string> = {
  wide: 'Wide establishing shot: show the whole room with the product(s) fully visible in their context.',
  medium:
    'Medium shot: the product(s) dominate the frame, with enough of the room visible around them for context.',
  close:
    'Close-up shot: frame tightly on the main product so it fills most of the frame, emphasizing fabric texture and details.',
};

const CAMERA_ANGLE_PHRASES: Record<string, string> = {
  front:
    'Camera straight-on, facing the main product frontally at eye level (about 120 cm high), symmetric composition.',
  'three-quarter-left':
    "Three-quarter view from the product's left side at eye level — the classic furniture catalog angle showing front and side.",
  'three-quarter-right':
    "Three-quarter view from the product's right side at eye level — the classic furniture catalog angle showing front and side.",
  side: 'Side profile view: camera perpendicular to the main product, showing its silhouette.',
  low: 'Slightly low hero angle (camera about 60 cm high, tilted gently up) making the product feel grand and monumental.',
  elevated:
    'Slightly elevated angle (camera about 180–200 cm high, tilted gently down) overlooking the arrangement.',
};

const LIGHTING_PHRASES: Record<string, string> = {
  morning:
    'Soft morning daylight streaming from a window: gentle warm glow, long soft shadows, fresh calm atmosphere.',
  'daylight-soft':
    'Bright diffused midday daylight: airy, neutral white balance, soft shadows, clean and natural.',
  golden:
    'Golden hour sunlight: warm low-angle beams, glowing highlights, cozy late-afternoon atmosphere.',
  evening:
    'Evening scene lit by warm interior lamps: intimate mood, pools of soft warm light, gently darkened corners.',
  studio:
    'Clean, neutral, studio-like lighting: even illumination, controlled soft shadows, color-accurate rendition of materials.',
};

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
  const variants = Math.max(0, input.variantCount ?? 0);
  const additions = Math.max(0, input.additionCount ?? 0);
  const packshotCount = mains + variants + additions;
  const refCount = effectiveReferenceCount(
    input.inspirationStrength,
    input.inspirationImageCount ?? 0,
    packshotCount
  );
  const totalImages = packshotCount + refCount;

  // Jawna mapa obrazów wejściowych — model musi wiedzieć, który obraz jest
  // packshotem, a który tylko referencją stylu (inaczej miesza cechy mebli
  // z inspiracji z produktem). Kolejność: główne → warianty → dodatki.
  const mapLines: string[] = [`INPUT IMAGES (${totalImages} total):`];
  if (packshotCount === 1) {
    mapLines.push('- Image 1: PRODUCT PACKSHOT (the main product).');
  } else {
    mapLines.push(
      mains === 1
        ? '- Image 1: PRODUCT PACKSHOT — the MAIN product (hero of the scene).'
        : `- Images 1–${mains}: PRODUCT PACKSHOTS — MAIN products (co-heroes of the scene${additions === 0 && variants === 0 ? ', a matching furniture collection' : ''}).`
    );
    if (variants > 0) {
      const from = mains + 1;
      const to = mains + variants;
      mapLines.push(
        `- ${variants === 1 ? `Image ${from}` : `Images ${from}–${to}`}: THE SAME product as the main packshot, shown in a DIFFERENT CONFIGURATION (e.g., the sofa unfolded into its sleeping position). Render it in the scene as an ADDITIONAL, SEPARATE instance of that same product: identical fabric, color, stitching and details — only the mechanical configuration differs. Both instances must appear together in the one scene.`
      );
    }
    if (additions > 0) {
      const from = mains + variants + 1;
      const to = packshotCount;
      mapLines.push(
        additions === 1
          ? `- Image ${from}: PRODUCT PACKSHOT — a SUPPORTING product (complementary, less prominent).`
          : `- Images ${from}–${to}: PRODUCT PACKSHOTS — SUPPORTING products (complementary, less prominent).`
      );
    }
  }
  if (refCount > 0) {
    mapLines.push(
      `- ${refCount === 1 ? `Image ${totalImages}` : `Images ${packshotCount + 1}–${totalImages}`}: STYLE INSPIRATION references — they describe the ROOM ONLY (palette, wall/floor materials, decor, lighting, mood). NEVER place furniture from these images into the scene as products and NEVER transfer their shapes, fabrics or details onto the packshot products.`
    );
  }
  parts.push(mapLines.join('\n'));

  // Instrukcje umiejscowienia przypisane do konkretnych packshotów.
  const noteLines = (input.packshotNotes ?? [])
    .slice(0, packshotCount)
    .map((note, i) => (note?.trim() ? `- Image ${i + 1}: ${note.trim()}` : null))
    .filter((l): l is string => Boolean(l));
  if (noteLines.length > 0) {
    parts.push(
      [
        'PRODUCT PLACEMENT NOTES (follow faithfully; they may be written in Polish — e.g. where to put the product and what to place on it):',
        ...noteLines,
      ].join('\n')
    );
  }

  const arrangeLine =
    packshotCount === 1
      ? 'Place the product from the packshot in a photorealistic interior scene described below.'
      : `Arrange ALL ${packshotCount} packshot ${variants > 0 ? 'images (including both configurations of the main product)' : 'products'} together in ONE photorealistic interior scene described below, with consistent scale between products.`;
  parts.push(
    `TASK: ${arrangeLine} Professional interior photography, realistic perspective, natural shadows and reflections consistent with the scene lighting, high-end furniture catalog quality. Render every packshot product tack-sharp, at the same level of detail and texture crispness as its packshot — do not soften, blur, repaint or simplify the product's fabric, pattern or edges.`
  );

  if (input.aspectRatio) {
    const orientation =
      input.aspectRatio === '1:1'
        ? 'square'
        : ['3:4', '9:16'].includes(input.aspectRatio)
          ? 'vertical (portrait)'
          : 'horizontal (landscape)';
    parts.push(
      `FRAME: The output image MUST have a strict ${input.aspectRatio} aspect ratio — a ${orientation} frame. Compose the scene deliberately for this format: fill the frame edge to edge, no letterboxing, borders or padding.`
    );
  }

  // Ujęcie i kąt kamery (gdy wybrane — inaczej model komponuje sam).
  const cameraLines: string[] = [];
  if (input.cameraShot && CAMERA_SHOT_PHRASES[input.cameraShot]) {
    cameraLines.push(CAMERA_SHOT_PHRASES[input.cameraShot]);
  }
  if (input.cameraAngle && CAMERA_ANGLE_PHRASES[input.cameraAngle]) {
    cameraLines.push(CAMERA_ANGLE_PHRASES[input.cameraAngle]);
  }
  if (cameraLines.length > 0) {
    cameraLines.push(
      'Realistic interior-photography perspective (roughly a 35–50 mm full-frame lens look), straight verticals, no fisheye or wide-angle distortion. The camera framing changes ONLY the viewpoint — never the product itself.'
    );
    parts.push(`CAMERA: ${cameraLines.join(' ')}`);
  }

  // Oświetlenie: preset (opcjonalny) + ZAWSZE integracja światła na produkcie.
  const lightingPreset =
    input.lighting && LIGHTING_PHRASES[input.lighting] ? LIGHTING_PHRASES[input.lighting] : null;
  parts.push(
    [
      lightingPreset ? `LIGHTING: ${lightingPreset}` : 'LIGHTING:',
      'LIGHTING INTEGRATION ON THE PRODUCTS: re-light every packshot product so it sits naturally in this scene — light direction, color temperature, soft shadows, contact shadows where it meets the floor/wall, and subtle reflections must all match the room lighting. This relighting must NOT change the product itself: geometry, proportions, fabric color, pattern, stitching and details stay exactly as in the packshot; only the illumination falling on the product adapts. The product must never look like a pasted-in cutout with flat studio lighting.',
    ]
      .join(' ')
      .trim()
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
 * Edycje często dotykają metek/logotypów — modele obrazowe chętnie je
 * "przerysowują" (łącznie z wymyślaniem cudzych marek). Twarda klauzula
 * ochrony tekstu i znaków firmowych w obu rodzinach promptów edycji.
 */
const EDIT_TEXT_LOCK_EN =
  'CRITICAL — TEXT & BRAND INTEGRITY: any visible text, logos, labels, tags or brand marks inside or near the edited region must be reproduced EXACTLY as in the original image — same wording, letterforms, logo design, colors and placement. NEVER invent, replace or substitute a different brand name or logo. If the instruction does not explicitly ask to change the text or logo, treat it as untouchable. The user instruction may be written in Polish.';

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
    EDIT_TEXT_LOCK_EN,
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
    EDIT_TEXT_LOCK_EN,
    'Blend the edit naturally with the surrounding image: match lighting, perspective, grain and color grading. Everything outside the mask must remain unchanged.',
  ].join('\n');
}
