import Anthropic from '@anthropic-ai/sdk';

// Taksonomia tagów dla kreacji e-commerce (mybed.pl / .de / mittohome).
// Trzymana osobno, bo używana dwukrotnie: w system prompcie (jako instrukcja
// dla modelu) i w walidacji odpowiedzi.
export const CREATIVE_TAG_TAXONOMY = {
  style: ['ugc', 'studio', 'lifestyle', 'packshot', 'render', 'mixed', 'unknown'] as const,
  angle: [
    'pain-point', 'benefit', 'social-proof', 'promo',
    'personalization', 'comfort', 'premium', 'design', 'education', 'unknown',
  ] as const,
  tone: ['energetic', 'calm', 'authoritative', 'friendly', 'urgent', 'aspirational', 'unknown'] as const,
  color_palette: ['neutral', 'warm', 'cool', 'bold', 'monochrome', 'unknown'] as const,
  product_focus: ['bed', 'mattress', 'bedding', 'pillow', 'accessory', 'bedroom-scene', 'logo-only', 'unknown'] as const,
};

export interface CreativeAIInsights {
  style: typeof CREATIVE_TAG_TAXONOMY.style[number];
  angle: typeof CREATIVE_TAG_TAXONOMY.angle[number];
  tone: typeof CREATIVE_TAG_TAXONOMY.tone[number];
  color_palette: typeof CREATIVE_TAG_TAXONOMY.color_palette[number];
  product_focus: typeof CREATIVE_TAG_TAXONOMY.product_focus[number];
  has_person: boolean;
  has_text_overlay: boolean;
  has_pricing: boolean;
  rationale: string;  // jedno zdanie "dlaczego te tagi"
}

const SYSTEM_PROMPT = `Jesteś analitykiem kreacji reklamowych dla brandu sypialnianego (łóżka, materace, pościel).
Twoje zadanie: przeanalizuj MINIATURĘ kreacji reklamowej Meta Ads + opcjonalnie tekst reklamy, i sklasyfikuj ją po kilku osiach.

ODPOWIADAJ WYŁĄCZNIE CZYSTYM JSON bez markdown, bez \`\`\`json\`\`\`, bez komentarzy, bez wyjaśnień.
JSON musi zawierać dokładnie te pola:
{
  "style": "ugc|studio|lifestyle|packshot|render|mixed|unknown",
  "angle": "pain-point|benefit|social-proof|promo|personalization|comfort|premium|design|education|unknown",
  "tone": "energetic|calm|authoritative|friendly|urgent|aspirational|unknown",
  "color_palette": "neutral|warm|cool|bold|monochrome|unknown",
  "product_focus": "bed|mattress|bedding|pillow|accessory|bedroom-scene|logo-only|unknown",
  "has_person": true|false,
  "has_text_overlay": true|false,
  "has_pricing": true|false,
  "rationale": "jedno zdanie po polsku, max 20 słów"
}

Zasady:
- Jeśli czegoś nie widać/nie da się ocenić, użyj "unknown". Nie zgaduj.
- rationale: jedno zdanie po polsku (max 20 słów).

Osie klasyfikacji:

STYLE — charakter wizualny:
- ugc: amatorski, selfie-style, handheld, autentyczny (telefon)
- studio: profesjonalna produkcja, czyste tło, oświetlenie
- lifestyle: ludzie używający produktu w realnym otoczeniu
- packshot: produkt na neutralnym tle (białe, gradient), bez kontekstu
- render: 3D/CGI, sztucznie wyrenderowane
- mixed: łączy kilka stylów
- unknown: nie da się ocenić

ANGLE — kąt komunikacyjny:
- pain-point: "bolą Cię plecy?", adresuje problem
- benefit: "lepszy sen", obietnica korzyści
- social-proof: opinie, rating, liczby klientów
- promo: wyprzedaż, rabat, kod promocyjny, cena
- personalization: "dopasowane do Ciebie", customization
- comfort: "miękko", "jak chmura", odczucia
- premium: luksus, jakość, prestiż
- design: estetyka, stylistyka wnętrza
- education: "jak wybrać materac", poradnikowe
- unknown

TONE: energetic, calm, authoritative, friendly, urgent, aspirational, unknown
COLOR_PALETTE: neutral (beż/szary), warm (ciepłe), cool (zimne niebieskie/zielone), bold (mocne kontrasty), monochrome, unknown
PRODUCT_FOCUS: bed, mattress, bedding, pillow, accessory, bedroom-scene, logo-only, unknown

Booleany: has_person (czy widać człowieka), has_text_overlay (czy jest nałożony tekst), has_pricing (czy widać cenę lub % rabatu).`;

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY env var is not set');
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

export interface CreativeTagInput {
  thumbnailUrl: string;
  adBody?: string | null;
  adTitle?: string | null;
  format?: string | null;  // 'video' | 'image' | ...
}

// Post-parse walidator — wpadający JSON wrzucamy przez ten filtr zanim
// zapiszemy do DB. Nieznane enumy → 'unknown', nie-boolean → false.
function sanitizeInsights(raw: Record<string, unknown>): CreativeAIInsights {
  const pick = <T extends readonly string[]>(
    value: unknown,
    allowed: T
  ): T[number] => {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value)
      ? (value as T[number])
      : ('unknown' as T[number]);
  };
  return {
    style: pick(raw.style, CREATIVE_TAG_TAXONOMY.style),
    angle: pick(raw.angle, CREATIVE_TAG_TAXONOMY.angle),
    tone: pick(raw.tone, CREATIVE_TAG_TAXONOMY.tone),
    color_palette: pick(raw.color_palette, CREATIVE_TAG_TAXONOMY.color_palette),
    product_focus: pick(raw.product_focus, CREATIVE_TAG_TAXONOMY.product_focus),
    has_person: raw.has_person === true,
    has_text_overlay: raw.has_text_overlay === true,
    has_pricing: raw.has_pricing === true,
    rationale: typeof raw.rationale === 'string' ? raw.rationale.slice(0, 300) : '',
  };
}

// Pobiera obrazek z Meta CDN, konwertuje na base64 dla vision API.
// Meta thumbnail_url wygasają po pewnym czasie; złap 404/403 i zwróć null.
async function fetchImageAsBase64(url: string): Promise<{ data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' } | null> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' = 'image/jpeg';
  if (contentType.includes('png')) mediaType = 'image/png';
  else if (contentType.includes('webp')) mediaType = 'image/webp';
  else if (contentType.includes('gif')) mediaType = 'image/gif';
  const buffer = await res.arrayBuffer();
  const data = Buffer.from(buffer).toString('base64');
  return { data, mediaType };
}

export async function classifyCreative(input: CreativeTagInput): Promise<CreativeAIInsights | null> {
  const image = await fetchImageAsBase64(input.thumbnailUrl);
  if (!image) return null;

  const client = getClient();
  const userTextParts: string[] = [];
  if (input.format) userTextParts.push(`Format kreacji z Meta API: ${input.format}`);
  if (input.adTitle) userTextParts.push(`Tytuł reklamy: ${input.adTitle}`);
  if (input.adBody) userTextParts.push(`Tekst reklamy:\n${input.adBody.slice(0, 500)}`);
  userTextParts.push('Sklasyfikuj kreację zgodnie ze schematem JSON.');

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        // System prompt jest identyczny dla każdej kreacji → cache go
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: image.mediaType, data: image.data },
          },
          { type: 'text', text: userTextParts.join('\n\n') },
        ],
      },
    ],
  });

  // Model został zinstruowany w system prompcie żeby zwracać WYŁĄCZNIE czysty JSON.
  // Bierzemy pierwszy text block i próbujemy sparsować. Jeśli model wbrew instrukcji
  // owinął JSON w ```json ... ```, ekstraktujemy przez match.
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') return null;

  let jsonStr = textBlock.text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    return sanitizeInsights(parsed);
  } catch (err) {
    console.warn('classifyCreative JSON parse failed:', err, jsonStr.slice(0, 200));
    return null;
  }
}

// Konwersja insightów → lista tagów (flat array dla kolumny ai_tags[])
export function insightsToTags(insights: CreativeAIInsights): string[] {
  const tags: string[] = [];
  if (insights.style !== 'unknown') tags.push(`style:${insights.style}`);
  if (insights.angle !== 'unknown') tags.push(`angle:${insights.angle}`);
  if (insights.tone !== 'unknown') tags.push(`tone:${insights.tone}`);
  if (insights.color_palette !== 'unknown') tags.push(`palette:${insights.color_palette}`);
  if (insights.product_focus !== 'unknown') tags.push(`focus:${insights.product_focus}`);
  if (insights.has_person) tags.push('has-person');
  if (insights.has_text_overlay) tags.push('has-text');
  if (insights.has_pricing) tags.push('has-pricing');
  return tags;
}
