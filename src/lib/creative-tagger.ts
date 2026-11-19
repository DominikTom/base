import Anthropic from '@anthropic-ai/sdk';

// Taksonomia tagów kreacji — ta sama co w skillu meta-ads-intel (serwer MCP
// /api/mcp zwraca te tagi w creatives_list / creative_detail). Używana w
// schemacie structured outputs, w system prompcie i w walidacji odpowiedzi.
export const CREATIVE_TAG_TAXONOMY = {
  angle: [
    'cena-promocja', 'jakosc-materialy', 'komfort-sen', 'design-aranzacja',
    'personalizacja-wymiary', 'dostawa-montaz-zwrot', 'opinie-social-proof',
    'ugc-tworcy', 'made-in-poland',
  ] as const,
  style: ['packshot-biale-tlo', 'lifestyle', 'ugc', 'motion', 'typografia'] as const,
  offer: ['brak', 'rabat-%', 'darmowa-dostawa', 'raty-0', 'gratis', 'kod'] as const,
  product: ['łóżko', 'materac', 'pościel', 'sofa', 'inne', 'nieznany'] as const,
};

type Angle = typeof CREATIVE_TAG_TAXONOMY.angle[number];
type Style = typeof CREATIVE_TAG_TAXONOMY.style[number];
type Offer = typeof CREATIVE_TAG_TAXONOMY.offer[number];
type Product = typeof CREATIVE_TAG_TAXONOMY.product[number];

export interface CreativeAIInsights {
  angle: Angle[];             // 1–2 kąty komunikacji, najważniejszy pierwszy
  hook: string;               // pierwsze 3 s / pierwsze zdanie — krótki opis
  style: Style | null;
  offer: Offer[];             // ['brak'], gdy nie ma oferty
  product: Product;
  product_collection: string; // np. „Lila”, pusty gdy nierozpoznawalna
  rationale: string;          // jedno zdanie „dlaczego te tagi”
  taxonomy_version: 'meta-ads-intel-1';
}

// JSON Schema dla output_config.format (structured outputs) — odpowiedź modelu
// zawsze pasuje do schematu; sanitizeInsights() i tak przycina wartości.
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['angle', 'hook', 'style', 'offer', 'product', 'product_collection', 'rationale'],
  properties: {
    angle: { type: 'array', items: { type: 'string', enum: [...CREATIVE_TAG_TAXONOMY.angle] } },
    hook: { type: 'string' },
    style: { type: 'string', enum: [...CREATIVE_TAG_TAXONOMY.style] },
    offer: { type: 'array', items: { type: 'string', enum: [...CREATIVE_TAG_TAXONOMY.offer] } },
    product: { type: 'string', enum: [...CREATIVE_TAG_TAXONOMY.product] },
    product_collection: { type: 'string' },
    rationale: { type: 'string' },
  },
} as const;

const SYSTEM_PROMPT = `Jesteś analitykiem kreacji reklamowych Meta Ads marek sypialnianych MyBed, MittoHome i NOMO (łóżka, materace, pościel, sofy).
Dostajesz miniaturę kreacji (dla wideo: klatkę) oraz opcjonalnie tytuł i tekst reklamy. Sklasyfikuj kreację według poniższych osi.

ANGLE — kąt komunikacji (1–2 wartości, najważniejszy pierwszy):
- cena-promocja: cena, rabat, wyprzedaż, okazja
- jakosc-materialy: tkaniny, wykonanie, trwałość, materiały
- komfort-sen: wygoda, wysypianie się, zdrowie kręgosłupa
- design-aranzacja: wygląd, styl wnętrza, aranżacja sypialni
- personalizacja-wymiary: wybór rozmiaru, tkaniny, koloru, konfigurator
- dostawa-montaz-zwrot: dostawa, wniesienie, montaż, zwrot, czas realizacji
- opinie-social-proof: opinie, oceny, liczba klientów, nagrody
- ugc-tworcy: twórcy, influencerzy, nagrania klientów
- made-in-poland: polska produkcja, rzemiosło

HOOK — jedno krótkie zdanie po polsku: co przyciąga uwagę w pierwszych 3 sekundach albo w pierwszym zdaniu tekstu.

STYLE — styl wizualny (jedna wartość):
- packshot-biale-tlo: produkt na neutralnym/białym tle
- lifestyle: produkt w aranżowanym wnętrzu, sceny z życia
- ugc: amatorskie ujęcie z telefonu, autentyczne
- motion: animacja, grafika ruchoma, montaż wideo z efektami
- typografia: dominuje tekst/grafika z napisami

OFFER — oferta widoczna na kreacji lub w tekście (może być kilka; „brak”, gdy nie ma żadnej):
rabat-% | darmowa-dostawa | raty-0 | gratis | kod

PRODUCT — główny produkt: łóżko | materac | pościel | sofa | inne | nieznany.
PRODUCT_COLLECTION — nazwa modelu/kolekcji, tylko gdy da się ją odczytać z obrazu lub tekstu (np. „Lila”); w przeciwnym razie pusty string.

RATIONALE — jedno zdanie po polsku (max 20 słów), dlaczego te tagi.

Nie zgaduj: jeśli produktu nie widać, wybierz „nieznany”.`;

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

// Walidator odpowiedzi — przycina wartości do taksonomii zanim trafią do bazy.
export function sanitizeInsights(raw: Record<string, unknown>): CreativeAIInsights {
  const inList = <T extends readonly string[]>(v: unknown, allowed: T): v is T[number] =>
    typeof v === 'string' && (allowed as readonly string[]).includes(v);
  const listOf = <T extends readonly string[]>(v: unknown, allowed: T, max: number): T[number][] =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is T[number] => inList(x, allowed)))].slice(0, max) : [];

  let offer = listOf(raw.offer, CREATIVE_TAG_TAXONOMY.offer, 5);
  if (offer.length > 1) offer = offer.filter(o => o !== 'brak');
  if (offer.length === 0) offer = ['brak'];

  return {
    angle: listOf(raw.angle, CREATIVE_TAG_TAXONOMY.angle, 2),
    hook: typeof raw.hook === 'string' ? raw.hook.trim().slice(0, 200) : '',
    style: inList(raw.style, CREATIVE_TAG_TAXONOMY.style) ? raw.style : null,
    offer,
    product: inList(raw.product, CREATIVE_TAG_TAXONOMY.product) ? raw.product : 'nieznany',
    product_collection: typeof raw.product_collection === 'string' ? raw.product_collection.trim().slice(0, 60) : '',
    rationale: typeof raw.rationale === 'string' ? raw.rationale.slice(0, 300) : '',
    taxonomy_version: 'meta-ads-intel-1',
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
    // Structured outputs: odpowiedź zawsze jest JSON-em zgodnym ze schematem.
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
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

  if (response.stop_reason === 'refusal') {
    throw new Error(`model odmówił klasyfikacji (${response.stop_details?.category ?? 'bez kategorii'})`);
  }
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') return null;

  try {
    return sanitizeInsights(JSON.parse(textBlock.text) as Record<string, unknown>);
  } catch (err) {
    console.warn('classifyCreative JSON parse failed:', err, textBlock.text.slice(0, 200));
    return null;
  }
}

// Konwersja insightów → lista tagów (kolumna ai_tags[]), format „oś:wartość”.
export function insightsToTags(insights: CreativeAIInsights): string[] {
  const tags: string[] = [];
  for (const a of insights.angle) tags.push(`angle:${a}`);
  if (insights.style) tags.push(`style:${insights.style}`);
  for (const o of insights.offer) tags.push(`offer:${o}`);
  if (insights.product !== 'nieznany') {
    tags.push(`product:${insights.product}`);
    if (insights.product_collection) tags.push(`product:${insights.product}:${insights.product_collection.toLowerCase()}`);
  }
  return tags;
}
