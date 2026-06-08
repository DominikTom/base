import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '@/lib/supabase';

// ─────────────────────────────────────────────────────────────────────
// /api/insights — wskazówki dla dashboardu „Mój Dashboard"
//
//   Metryki liczymy deterministycznie z fact_orders / fact_order_items
//   (porównanie okres-do-okresu). Claude przerabia je na 2–4 zdania-wskazówki.
//   Cache w tabeli insights_cache (key=shop|range), TTL = 1h. Fallback: gdy
//   LLM nie odpowiada — generujemy wskazówki z szablonów.
// ─────────────────────────────────────────────────────────────────────

const TTL_MS = 60 * 60 * 1000;            // 1h
const MODEL = 'claude-haiku-4-5-20251001'; // szybki/tani — krótki tekst po polsku
const MAX_TOKENS = 600;

let cachedAnthropic: Anthropic | null = null;
function getAnthropic(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!cachedAnthropic) cachedAnthropic = new Anthropic({ apiKey: key });
  return cachedAnthropic;
}

type Range = '7d' | '30d' | 'quarter';
type InsightKind = 'positive' | 'negative' | 'neutral' | 'alert';
interface Insight {
  title: string;
  body: string;
  badge?: string | null;   // np. „+18%" / „−40%"
  kind: InsightKind;
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const shop = (url.searchParams.get('shop') || 'all').toLowerCase();
    const rangeParam = url.searchParams.get('range');
    const range: Range = rangeParam === 'quarter' ? 'quarter'
      : rangeParam === '7d' ? '7d'
      : '30d';   // domyślnie 30 dni — 7 dni dało za mało próbki na sensowne wskazówki
    const force = url.searchParams.get('force') === '1';
    const scope_key = `dashboard:${shop}:${range}`;

    const db = getSupabaseAdmin();

    // Cache lookup
    if (!force) {
      const { data: cached } = await db
        .from('insights_cache')
        .select('generated_at, payload')
        .eq('scope_key', scope_key)
        .maybeSingle();
      if (cached) {
        const age = Date.now() - new Date(cached.generated_at).getTime();
        if (age < TTL_MS) {
          return NextResponse.json({
            ...cached.payload,
            cached: true,
            generated_at: cached.generated_at,
            age_minutes: Math.round(age / 60000),
          });
        }
      }
    }

    // ── Daty okresu ────────────────────────────────────────────────
    const days = range === 'quarter' ? 90 : range === '30d' ? 30 : 7;
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    const curTo = new Date(today); curTo.setHours(23, 59, 59, 999);
    const curFrom = new Date(today); curFrom.setDate(today.getDate() - (days - 1)); curFrom.setHours(0, 0, 0, 0);
    const prevTo = new Date(curFrom); prevTo.setDate(curFrom.getDate() - 1); prevTo.setHours(23, 59, 59, 999);
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevTo.getDate() - (days - 1)); prevFrom.setHours(0, 0, 0, 0);

    const ranges = {
      current: { from: fmt(curFrom), to: fmt(curTo) },
      previous: { from: fmt(prevFrom), to: fmt(prevTo) },
    };

    // ── Liczenie metryk ────────────────────────────────────────────
    const metrics = await computeMetrics(db, shop, ranges);

    // ── Tekst wskazówek ───────────────────────────────────────────
    let insights: Insight[];
    try {
      insights = await generateInsightsWithLLM(metrics, range);
    } catch (err) {
      console.warn('LLM insights failed, falling back to templates:', err);
      insights = buildTemplateInsights(metrics);
    }

    const payload = { insights, metrics, ranges, range, shop };

    await db.from('insights_cache').upsert({
      scope_key,
      generated_at: new Date().toISOString(),
      payload,
    });

    return NextResponse.json({ ...payload, cached: false });
  } catch (err) {
    console.error('insights GET error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────
// SQL — liczenie metryk
// ─────────────────────────────────────────────────────────────────────
interface MetricsBundle {
  revenue: { current: number; previous: number; pct: number | null };
  orders:  { current: number; previous: number; pct: number | null };
  top_products_current: Array<{ name: string; qty: number }>;
  top_products_previous: Array<{ name: string; qty: number }>;
  new_in_top: string[];                       // produkty NOWE w top 3 bieżącego okresu
  dropped_from_top: string[];                 // produkty co WYPADŁY z top 3
  biggest_winner: { name: string; pct: number; cur: number; prev: number } | null;
  biggest_loser:  { name: string; pct: number; cur: number; prev: number } | null;
  top_category: { name: string; revenue: number } | null;
}

async function computeMetrics(
  db: ReturnType<typeof getSupabaseAdmin>,
  shop: string,
  ranges: { current: { from: string; to: string }; previous: { from: string; to: string } },
): Promise<MetricsBundle> {
  // PostgREST ma twardy server-side cap 1000 wierszy/zapytanie — `.limit()` go
  // nie omija. Paginujemy przez `.range()` w pętli.
  const PAGE = 1000;

  // Helper — pobiera zamówienia + sumy revenue i count
  async function fetchOrdersWindow(from: string, to: string) {
    const orders: Array<{ order_id: string; total_gross_pln: number | null }> = [];
    let offset = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let q = db.from('fact_orders')
        .select('order_id, total_gross_pln')
        .gte('order_date', from)
        .lte('order_date', `${to}T23:59:59`)
        .range(offset, offset + PAGE - 1);
      if (shop !== 'all') q = q.eq('source_shop', shop);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      orders.push(...(data as typeof orders));
      if (data.length < PAGE) break;
      offset += PAGE;
    }
    const revenue = orders.reduce((s, r) => s + (Number(r.total_gross_pln) || 0), 0);
    return { orders, revenue, count: orders.length };
  }

  const [cur, prev] = await Promise.all([
    fetchOrdersWindow(ranges.current.from, ranges.current.to),
    fetchOrdersWindow(ranges.previous.from, ranges.previous.to),
  ]);

  // Item-level: top produkty + kategoria. Paginujemy w obrębie każdego chunka
  // order_id — chunk=500 zamówień może mieć >1000 pozycji.
  async function fetchItems(orderIds: string[]): Promise<Array<{ order_id: string; product_name: string; product_category: string; quantity: number }>> {
    if (orderIds.length === 0) return [];
    const out: Array<{ order_id: string; product_name: string; product_category: string; quantity: number }> = [];
    const CHUNK = 500;
    for (let i = 0; i < orderIds.length; i += CHUNK) {
      const chunk = orderIds.slice(i, i + CHUNK);
      let offset = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data } = await db.from('v_order_items')
          .select('order_id, product_name, product_category, quantity')
          .in('order_id', chunk)
          .not('item_type', 'in', '("shipping","service","surcharge")')
          .range(offset, offset + PAGE - 1);
        if (!data || data.length === 0) break;
        out.push(...(data as Array<{ order_id: string; product_name: string; product_category: string; quantity: number }>));
        if (data.length < PAGE) break;
        offset += PAGE;
      }
    }
    return out;
  }

  const [curItems, prevItems] = await Promise.all([
    fetchItems(cur.orders.map(o => o.order_id)),
    fetchItems(prev.orders.map(o => o.order_id)),
  ]);

  function aggByProduct(items: Array<{ product_name: string; quantity: number }>) {
    const map: Record<string, number> = {};
    for (const it of items) {
      const name = (it.product_name || '').trim();
      if (!name) continue;
      map[name] = (map[name] || 0) + (Number(it.quantity) || 0);
    }
    return map;
  }
  function aggByCategory(items: Array<{ product_category: string; quantity: number }>) {
    const map: Record<string, number> = {};
    for (const it of items) {
      const c = (it.product_category || '').trim() || 'inne';
      map[c] = (map[c] || 0) + (Number(it.quantity) || 0);
    }
    return map;
  }
  const curByProd = aggByProduct(curItems);
  const prevByProd = aggByProduct(prevItems);
  const curByCat = aggByCategory(curItems);

  const sortDesc = (m: Record<string, number>) => Object.entries(m).sort(([, a], [, b]) => b - a);
  const curTop = sortDesc(curByProd).slice(0, 5).map(([name, qty]) => ({ name, qty }));
  const prevTop = sortDesc(prevByProd).slice(0, 5).map(([name, qty]) => ({ name, qty }));

  const curTop3 = new Set(curTop.slice(0, 3).map(p => p.name));
  const prevTop3 = new Set(prevTop.slice(0, 3).map(p => p.name));
  const new_in_top = [...curTop3].filter(n => !prevTop3.has(n));
  const dropped_from_top = [...prevTop3].filter(n => !curTop3.has(n));

  // Winner / loser — produkty z największym ruchem WoW (min 3 sztuki sumarycznie)
  const allProducts = new Set([...Object.keys(curByProd), ...Object.keys(prevByProd)]);
  let winner: MetricsBundle['biggest_winner'] = null;
  let loser: MetricsBundle['biggest_loser'] = null;
  for (const name of allProducts) {
    const c = curByProd[name] || 0;
    const p = prevByProd[name] || 0;
    if (c + p < 3) continue;
    const pct = p > 0 ? ((c - p) / p) * 100 : c > 0 ? 1000 : 0;
    if (!winner || pct > winner.pct) winner = { name, pct, cur: c, prev: p };
    if (!loser  || pct < loser.pct)  loser  = { name, pct, cur: c, prev: p };
  }
  // Loser ma sens tylko gdy spadł >= 20% i wcześniej był sprzedawany
  if (loser && (loser.pct > -20 || loser.prev < 3)) loser = null;
  if (winner && winner.pct < 30) winner = null;

  const topCat = sortDesc(curByCat).slice(0, 1)[0];
  const top_category = topCat ? { name: topCat[0], revenue: topCat[1] } : null;

  const revenuePct = prev.revenue > 0 ? ((cur.revenue - prev.revenue) / prev.revenue) * 100 : null;
  const ordersPct  = prev.count > 0 ? ((cur.count - prev.count) / prev.count) * 100 : null;

  return {
    revenue: { current: cur.revenue, previous: prev.revenue, pct: revenuePct },
    orders:  { current: cur.count,   previous: prev.count,   pct: ordersPct },
    top_products_current: curTop,
    top_products_previous: prevTop,
    new_in_top,
    dropped_from_top,
    biggest_winner: winner,
    biggest_loser: loser,
    top_category,
  };
}

// ─────────────────────────────────────────────────────────────────────
// LLM — Claude przerabia liczby na 2–4 wskazówki po polsku
// ─────────────────────────────────────────────────────────────────────
async function generateInsightsWithLLM(metrics: MetricsBundle, range: Range): Promise<Insight[]> {
  const anthropic = getAnthropic();
  if (!anthropic) throw new Error('no ANTHROPIC_API_KEY');

  const period = range === 'quarter'
    ? 'ostatni kwartał (90 dni) vs poprzedni kwartał'
    : range === '30d'
    ? 'ostatnie 30 dni vs poprzednie 30 dni'
    : 'ostatnie 7 dni vs poprzednie 7 dni';

  const systemPrompt = `Jesteś analitykiem MyBed Group. Piszesz krótkie, konkretne wskazówki po polsku — bez wody, bez "wnioski są takie", bez dukania.

ZASADY:
- 2-4 wskazówki maksymalnie. Każda = jedno krótkie zdanie (max 20 słów).
- Tylko fakty z dostarczonych liczb. NIC nie wymyślaj.
- Pomijaj nieistotne (np. zmiana <5% nie jest wskazówką).
- Każda wskazówka ma kind: positive (wzrost), negative (spadek), neutral (zmiana mix), alert (coś wymaga reakcji).
- Jeśli zmiana jest %, dodaj badge typu "+18%" lub "−40%". Bez badge gdy zmiana niemierzalna.

ODPOWIEDZ TYLKO JSON-em w formie {"insights":[{"title":"...","body":"...","badge":"+18%"|null,"kind":"positive|negative|neutral|alert"}, ...]}.
Bez markdown'a, bez \`\`\`json, bez nic poza JSON-em.`;

  const userPrompt = `Okres: ${period}.

Metryki:
${JSON.stringify({
  revenue: metrics.revenue,
  orders: metrics.orders,
  new_in_top: metrics.new_in_top,
  dropped_from_top: metrics.dropped_from_top,
  biggest_winner: metrics.biggest_winner,
  biggest_loser: metrics.biggest_loser,
  top_category: metrics.top_category,
  top_3_current: metrics.top_products_current.slice(0, 3).map(p => p.name),
  top_3_previous: metrics.top_products_previous.slice(0, 3).map(p => p.name),
}, null, 2)}

Napisz wskazówki.`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = res.content
    .map(b => (b.type === 'text' ? b.text : ''))
    .join('').trim();

  // Tolerujemy gdyby model jednak owinął w ```json.
  const jsonStr = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(jsonStr) as { insights?: Insight[] };
  if (!parsed.insights || !Array.isArray(parsed.insights) || parsed.insights.length === 0) {
    throw new Error('LLM returned empty insights');
  }
  return parsed.insights.slice(0, 4).map(i => ({
    title: String(i.title || '').trim().slice(0, 100),
    body:  String(i.body  || '').trim().slice(0, 240),
    badge: i.badge ? String(i.badge).slice(0, 12) : null,
    kind:  (['positive', 'negative', 'neutral', 'alert'].includes(i.kind) ? i.kind : 'neutral') as InsightKind,
  }));
}

// ─────────────────────────────────────────────────────────────────────
// Fallback — gdy LLM nie zadziała, sklej wskazówki z szablonów
// ─────────────────────────────────────────────────────────────────────
function buildTemplateInsights(m: MetricsBundle): Insight[] {
  const out: Insight[] = [];
  const fmtPct = (pct: number) => `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;

  if (m.revenue.pct != null && Math.abs(m.revenue.pct) >= 5) {
    out.push({
      title: m.revenue.pct >= 0 ? 'Przychód rośnie' : 'Przychód spada',
      body: `Przychód okresu vs poprzedni: ${fmtPct(m.revenue.pct)}.`,
      badge: fmtPct(m.revenue.pct),
      kind: m.revenue.pct >= 0 ? 'positive' : 'negative',
    });
  }
  if (m.new_in_top.length > 0) {
    out.push({
      title: 'Zmiana w top 3 produktów',
      body: `Nowe w top 3: ${m.new_in_top.join(', ')}.`,
      badge: null,
      kind: 'neutral',
    });
  }
  if (m.biggest_winner) {
    out.push({
      title: 'Produkt z największym wzrostem',
      body: `${m.biggest_winner.name}: ${m.biggest_winner.prev} → ${m.biggest_winner.cur} szt.`,
      badge: fmtPct(m.biggest_winner.pct),
      kind: 'positive',
    });
  }
  if (m.biggest_loser) {
    out.push({
      title: 'Uwaga: nagły spadek',
      body: `${m.biggest_loser.name}: ${m.biggest_loser.prev} → ${m.biggest_loser.cur} szt.`,
      badge: fmtPct(m.biggest_loser.pct),
      kind: 'alert',
    });
  }
  if (out.length === 0) {
    out.push({
      title: 'Stabilnie',
      body: 'Brak istotnych zmian w ostatnim okresie.',
      badge: null,
      kind: 'neutral',
    });
  }
  return out.slice(0, 4);
}
