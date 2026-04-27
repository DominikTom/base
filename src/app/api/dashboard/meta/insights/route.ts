import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { SHOP_TO_META_ACCOUNT } from '@/lib/meta-ads';

// Insights endpoint — generuje porównania segmentów z fact_daily_ad_performance
// JOIN dim_creatives po ai_insights.{style,angle,tone,product_focus} oraz
// boolean'ach (has_person, has_text_overlay, has_pricing).
//
// Output: per-axis breakdown z agregowanymi KPI + auto-generowane zdania
// porównawcze ("UGC video bije static o N% ROAS").

const AXES: Array<{ key: string; label: string; source: 'insights' | 'auto_tags' }> = [
  { key: 'style', label: 'Styl', source: 'insights' },
  { key: 'angle', label: 'Kąt komunikacji', source: 'insights' },
  { key: 'tone', label: 'Ton', source: 'insights' },
  { key: 'product_focus', label: 'Produkt w kadrze', source: 'insights' },
  { key: 'color_palette', label: 'Paleta kolorów', source: 'insights' },
];

const BOOLS: Array<{ key: string; label: string; positiveLabel: string; negativeLabel: string }> = [
  { key: 'has_person', label: 'Osoba w kadrze', positiveLabel: 'z osobą', negativeLabel: 'bez osoby' },
  { key: 'has_text_overlay', label: 'Tekst nałożony', positiveLabel: 'z tekstem', negativeLabel: 'bez tekstu' },
  { key: 'has_pricing', label: 'Cena widoczna', positiveLabel: 'z ceną', negativeLabel: 'bez ceny' },
];

async function fetchAllAdPerf(params: {
  dateFrom: string; dateTo: string; accountId: string | null;
}): Promise<Array<Record<string, unknown>>> {
  const db = getSupabaseAdmin();
  const PAGE_SIZE = 1000;
  const rows: Array<Record<string, unknown>> = [];
  let offset = 0;
  while (true) {
    let q = db.from('fact_daily_ad_performance')
      .select('creative_id, spend, impressions, clicks, conversions, conversion_value, video_play_3s')
      .gte('date', params.dateFrom)
      .lte('date', params.dateTo)
      .order('date', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (params.accountId) q = q.eq('account_id', params.accountId);
    const { data, error } = await q;
    if (error) throw new Error(`fact_daily_ad_performance: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as Array<Record<string, unknown>>));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

async function fetchAllCreatives(accountId: string | null): Promise<Map<string, Record<string, unknown>>> {
  const db = getSupabaseAdmin();
  const PAGE_SIZE = 1000;
  const map = new Map<string, Record<string, unknown>>();
  let offset = 0;
  while (true) {
    let q = db.from('dim_creatives')
      .select('creative_id, format, ai_insights, ai_tags, is_dynamic')
      .order('last_seen_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (accountId) q = q.eq('account_id', accountId);
    const { data, error } = await q;
    if (error) throw new Error(`dim_creatives: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      map.set(row.creative_id as string, row as Record<string, unknown>);
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return map;
}

interface SegmentAgg {
  segment: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  video_play_3s: number;
  creative_count: Set<string>;
}

function emptySeg(segment: string): SegmentAgg {
  return {
    segment, spend: 0, impressions: 0, clicks: 0,
    conversions: 0, conversion_value: 0, video_play_3s: 0,
    creative_count: new Set(),
  };
}

function buildSegments(
  factRows: Array<Record<string, unknown>>,
  creatives: Map<string, Record<string, unknown>>,
  axisKey: string,
  source: 'insights' | 'auto_tags' | 'bool',
): Map<string, SegmentAgg> {
  const segs = new Map<string, SegmentAgg>();
  for (const r of factRows) {
    const cid = r.creative_id as string;
    if (!cid) continue;
    const creative = creatives.get(cid);
    if (!creative) continue;
    let segment: string | null = null;
    if (source === 'insights') {
      const insights = creative.ai_insights as Record<string, unknown> | null;
      if (!insights) continue;
      const v = insights[axisKey];
      if (typeof v !== 'string' || v === 'unknown' || !v) continue;
      segment = v;
    } else if (source === 'bool') {
      const insights = creative.ai_insights as Record<string, unknown> | null;
      if (!insights) continue;
      const v = insights[axisKey];
      if (typeof v !== 'boolean') continue;
      segment = v ? 'true' : 'false';
    } else {
      const tags = creative.auto_tags as string[] | null;
      if (!tags || !tags.includes(axisKey)) continue;
      segment = axisKey;
    }
    if (!segment) continue;
    const cur = segs.get(segment) || emptySeg(segment);
    cur.spend += Number(r.spend) || 0;
    cur.impressions += Number(r.impressions) || 0;
    cur.clicks += Number(r.clicks) || 0;
    cur.conversions += Number(r.conversions) || 0;
    cur.conversion_value += Number(r.conversion_value) || 0;
    cur.video_play_3s += Number(r.video_play_3s) || 0;
    cur.creative_count.add(cid);
    segs.set(segment, cur);
  }
  return segs;
}

function metricsOf(s: SegmentAgg) {
  return {
    spend: Math.round(s.spend),
    impressions: s.impressions,
    clicks: s.clicks,
    conversions: s.conversions,
    conversion_value: Math.round(s.conversion_value),
    roas: s.spend > 0 ? Math.round((s.conversion_value / s.spend) * 100) / 100 : 0,
    ctr: s.impressions > 0 ? Math.round((s.clicks / s.impressions) * 10000) / 100 : 0,
    cpa: s.conversions > 0 ? Math.round((s.spend / s.conversions) * 100) / 100 : 0,
    hook_rate: s.impressions > 0 ? Math.round((s.video_play_3s / s.impressions) * 10000) / 100 : 0,
    creatives: s.creative_count.size,
  };
}

interface InsightSentence {
  text: string;
  axis: string;
  metric: string;
  significance: 'high' | 'medium' | 'low';
}

// Generuje top porównawcze zdania per oś. Zwraca tylko gdy:
// - top segment ma >2 kreacje (bo 1-2 to anegdota)
// - różnica vs średnia >15% (bo mniejsze to szum)
function generateInsights(
  axisKey: string,
  axisLabel: string,
  segments: Map<string, SegmentAgg>,
): InsightSentence[] {
  const arr = Array.from(segments.values()).filter(s => s.creative_count.size >= 2);
  if (arr.length < 2) return [];

  const sentences: InsightSentence[] = [];
  const totalSpend = arr.reduce((sum, s) => sum + s.spend, 0);

  for (const metric of ['roas', 'ctr', 'hook_rate', 'cpa'] as const) {
    const lowerIsBetter = metric === 'cpa';
    // Tylko segmenty które mają realne dane (np. dla hook_rate — wymaga video views)
    const relevant = arr.filter(s => {
      if (metric === 'hook_rate') return s.video_play_3s > 0;
      if (metric === 'cpa') return s.conversions > 0;
      return s.impressions > 0;
    });
    if (relevant.length < 2) continue;
    const sorted = [...relevant].sort((a, b) => {
      const va = metricsOf(a)[metric] as number;
      const vb = metricsOf(b)[metric] as number;
      return lowerIsBetter ? va - vb : vb - va;
    });
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    const topVal = metricsOf(top)[metric] as number;
    const bottomVal = metricsOf(bottom)[metric] as number;
    if (topVal === 0 || bottomVal === 0) continue;
    const diffPct = lowerIsBetter
      ? Math.round(((bottomVal - topVal) / bottomVal) * 100)
      : Math.round(((topVal - bottomVal) / bottomVal) * 100);
    if (Math.abs(diffPct) < 15) continue;

    const metricLabel = {
      roas: 'ROAS',
      ctr: 'CTR',
      hook_rate: 'hook rate',
      cpa: 'CPA',
    }[metric];

    const formatVal = (v: number) =>
      metric === 'roas' ? `${v.toFixed(2)}x` :
      metric === 'cpa' ? `${v.toFixed(0)} zł` :
      `${v.toFixed(2)}%`;

    const text = lowerIsBetter
      ? `${axisLabel} "${top.segment}" ma ${metricLabel} niższy o ${Math.abs(diffPct)}% niż "${bottom.segment}" (${formatVal(topVal)} vs ${formatVal(bottomVal)})`
      : `${axisLabel} "${top.segment}" ma ${metricLabel} wyższy o ${diffPct}% niż "${bottom.segment}" (${formatVal(topVal)} vs ${formatVal(bottomVal)})`;

    const spendShare = totalSpend > 0 ? top.spend / totalSpend : 0;
    const significance: InsightSentence['significance'] =
      Math.abs(diffPct) > 50 && spendShare > 0.2 ? 'high' :
      Math.abs(diffPct) > 25 ? 'medium' : 'low';

    sentences.push({ text, axis: axisLabel, metric, significance });
  }

  return sentences;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from') || '2025-01-01';
    const dateTo = searchParams.get('date_to') || new Date().toISOString().split('T')[0];
    const shop = searchParams.get('shop') || 'all';
    const accountIdFilter = shop === 'all' ? null : (SHOP_TO_META_ACCOUNT[shop] ?? 'NONE');

    const [factRows, creatives] = await Promise.all([
      fetchAllAdPerf({ dateFrom, dateTo, accountId: accountIdFilter }),
      fetchAllCreatives(accountIdFilter),
    ]);

    // Per-axis breakdowns
    const breakdowns: Record<string, {
      label: string;
      segments: Array<ReturnType<typeof metricsOf> & { segment: string }>;
    }> = {};
    const allInsights: InsightSentence[] = [];

    for (const axis of AXES) {
      const segs = buildSegments(factRows, creatives, axis.key, 'insights');
      if (segs.size === 0) continue;
      const segments = Array.from(segs.values())
        .map(s => ({ segment: s.segment, ...metricsOf(s) }))
        .sort((a, b) => b.spend - a.spend);
      breakdowns[axis.key] = { label: axis.label, segments };
      allInsights.push(...generateInsights(axis.key, axis.label, segs));
    }

    // Boolean axes — porównanie has/no
    for (const b of BOOLS) {
      const segs = buildSegments(factRows, creatives, b.key, 'bool');
      if (segs.size === 0) continue;
      const renamed = new Map<string, SegmentAgg>();
      for (const [k, v] of segs.entries()) {
        renamed.set(k === 'true' ? b.positiveLabel : b.negativeLabel, { ...v, segment: k === 'true' ? b.positiveLabel : b.negativeLabel });
      }
      const segments = Array.from(renamed.values())
        .map(s => ({ segment: s.segment, ...metricsOf(s) }))
        .sort((a, b) => b.spend - a.spend);
      breakdowns[b.key] = { label: b.label, segments };
      allInsights.push(...generateInsights(b.key, b.label, renamed));
    }

    // Format breakdown — z dim_creatives.format (nie ai_insights)
    const formatSegs = new Map<string, SegmentAgg>();
    for (const r of factRows) {
      const cid = r.creative_id as string;
      const c = creatives.get(cid);
      if (!c) continue;
      const fmt = (c.format as string) || 'unknown';
      const cur = formatSegs.get(fmt) || emptySeg(fmt);
      cur.spend += Number(r.spend) || 0;
      cur.impressions += Number(r.impressions) || 0;
      cur.clicks += Number(r.clicks) || 0;
      cur.conversions += Number(r.conversions) || 0;
      cur.conversion_value += Number(r.conversion_value) || 0;
      cur.video_play_3s += Number(r.video_play_3s) || 0;
      cur.creative_count.add(cid);
      formatSegs.set(fmt, cur);
    }
    if (formatSegs.size > 0) {
      breakdowns.format = {
        label: 'Format',
        segments: Array.from(formatSegs.values())
          .map(s => ({ segment: s.segment, ...metricsOf(s) }))
          .sort((a, b) => b.spend - a.spend),
      };
      allInsights.push(...generateInsights('format', 'Format', formatSegs));
    }

    // Sort insights — high significance first
    allInsights.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.significance] - order[b.significance];
    });

    // Coverage info — ile kreacji w bazie ma ai_insights
    const totalCreatives = creatives.size;
    const taggedCreatives = Array.from(creatives.values())
      .filter(c => c.ai_insights !== null && c.ai_insights !== undefined).length;

    return NextResponse.json({
      coverage: {
        total: totalCreatives,
        tagged: taggedCreatives,
        coverage_pct: totalCreatives > 0 ? Math.round((taggedCreatives / totalCreatives) * 100) : 0,
      },
      insights: allInsights,
      breakdowns,
    });
  } catch (err) {
    console.error('Meta insights error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
