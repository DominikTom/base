import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '@/lib/supabase';
import { shopFilterLabel } from '@/lib/shop-filter';

// ─────────────────────────────────────────────────────────────────────
// /api/weather/summary — krótkie podsumowanie AI korelacji pogodowych.
//
//   Frontend POSTuje policzone statystyki (korelacje + kubełki z
//   /api/weather) — liczby są deterministyczne, LLM tylko pisze tekst.
//   Cache w insights_cache (scope_key = weather:{shop}:{from}:{to}:{y}),
//   TTL 1h. Fallback szablonowy gdy LLM niedostępny.
// ─────────────────────────────────────────────────────────────────────

const TTL_MS = 60 * 60 * 1000;
const MODEL = 'claude-haiku-4-5-20251001';

let cachedAnthropic: Anthropic | null = null;
function getAnthropic(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!cachedAnthropic) cachedAnthropic = new Anthropic({ apiKey: key });
  return cachedAnthropic;
}

interface BucketIn {
  label: string;
  n: number;
  pctVsAvg: number | null;
  avgRevenue: number;
}

interface SummaryInput {
  shop: string;
  from: string;
  to: string;
  y: 'revenue' | 'orders';
  correlation: { r: number; n: number; valid: boolean };
  correlationNormalized?: { r: number; n: number; valid: boolean };
  metricLabel: string;
  buckets: {
    precip: BucketIn[];
    sunshine: BucketIn[];
    temp: BucketIn[];
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<SummaryInput> & { force?: boolean };
    const shop = String(body.shop || 'all').toLowerCase();
    const from = String(body.from || '');
    const to = String(body.to || '');
    const y = body.y === 'orders' ? 'orders' : 'revenue';
    if (!from || !to || !body.buckets) {
      return NextResponse.json({ error: 'Brak wymaganych pól (from/to/buckets)' }, { status: 400 });
    }

    const scope_key = `weather:${shop}:${from}:${to}:${y}`;
    const db = getSupabaseAdmin();

    if (!body.force) {
      const { data: cached } = await db
        .from('insights_cache')
        .select('generated_at, payload')
        .eq('scope_key', scope_key)
        .maybeSingle();
      if (cached) {
        const age = Date.now() - new Date(cached.generated_at).getTime();
        if (age < TTL_MS) {
          return NextResponse.json({ ...cached.payload, cached: true, age_minutes: Math.round(age / 60000) });
        }
      }
    }

    let summary: string;
    try {
      summary = await generateWithLLM(body as SummaryInput);
    } catch (err) {
      console.warn('weather summary LLM failed, fallback to template:', err);
      summary = buildTemplateSummary(body as SummaryInput);
    }

    const payload = { summary, shop, from, to, y };
    await db.from('insights_cache').upsert({
      scope_key,
      generated_at: new Date().toISOString(),
      payload,
    });

    return NextResponse.json({ ...payload, cached: false });
  } catch (err) {
    console.error('weather summary error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function generateWithLLM(input: SummaryInput): Promise<string> {
  const anthropic = getAnthropic();
  if (!anthropic) throw new Error('no ANTHROPIC_API_KEY');

  const yLabel = input.y === 'orders' ? 'liczbą zamówień' : 'przychodem';
  const shopLabel = shopFilterLabel(input.shop);

  const systemPrompt = `Jesteś analitykiem MyBed Group. Piszesz krótkie podsumowanie wpływu pogody na sprzedaż po polsku.

ZASADY:
- 2-4 zdania, zwięźle, bez lania wody.
- Tylko fakty z dostarczonych liczb. NIC nie wymyślaj.
- Kubełki są znormalizowane dniem tygodnia: pctVsAvg to % różnicy vs typowy taki dzień tygodnia.
- Pomijaj kubełki z n < 5 dni (za mała próbka) i zmiany < 3% (nieistotne).
- Jeśli widzisz wyraźny wzór (np. deszcz konsekwentnie podnosi sprzedaż), nazwij go wprost i podaj liczby.
- Jeśli nie ma istotnych wzorów, powiedz to krótko.
- Odpowiedz CZYSTYM TEKSTEM (bez markdown, bez list, bez nagłówków).`;

  const userPrompt = `Okres: ${input.from} → ${input.to}, sklep: ${shopLabel}, metryka sprzedaży: ${yLabel}.

Korelacja Pearsona (${input.metricLabel} vs sprzedaż):
- surowa: ${input.correlation?.valid ? input.correlation.r.toFixed(3) : 'brak danych'}
- po normalizacji dniem tygodnia: ${input.correlationNormalized?.valid ? input.correlationNormalized.r.toFixed(3) : 'brak danych'}

Kubełki (pctVsAvg = % vs typowy dzień tygodnia, n = liczba dni):
Opady: ${JSON.stringify(input.buckets.precip)}
Nasłonecznienie: ${JSON.stringify(input.buckets.sunshine)}
Temperatura: ${JSON.stringify(input.buckets.temp)}

Napisz podsumowanie.`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim();
  if (!text) throw new Error('LLM returned empty summary');
  return text.slice(0, 900);
}

// Fallback bez LLM — sklejamy najmocniejsze sygnały z kubełków.
function buildTemplateSummary(input: SummaryInput): string {
  const parts: string[] = [];
  const all: Array<{ category: string; b: BucketIn }> = [
    ...input.buckets.precip.map(b => ({ category: 'opady', b })),
    ...input.buckets.sunshine.map(b => ({ category: 'nasłonecznienie', b })),
    ...input.buckets.temp.map(b => ({ category: 'temperatura', b })),
  ];
  const significant = all
    .filter(({ b }) => b.n >= 5 && b.pctVsAvg != null && Math.abs(b.pctVsAvg) >= 3)
    .sort((a, z) => Math.abs(z.b.pctVsAvg!) - Math.abs(a.b.pctVsAvg!))
    .slice(0, 3);

  for (const { b } of significant) {
    const dir = b.pctVsAvg! >= 0 ? 'wyższą' : 'niższą';
    parts.push(`${b.label}: sprzedaż ${dir} o ${Math.abs(b.pctVsAvg!).toFixed(1)}% niż typowy dzień (${b.n} dni).`);
  }
  if (parts.length === 0) {
    return 'W badanym okresie nie widać istotnego wpływu pogody na sprzedaż — żaden typ pogody nie odchyla sprzedaży o więcej niż 3% od typowego dnia tygodnia.';
  }
  return parts.join(' ');
}
