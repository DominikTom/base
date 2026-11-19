import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { badRequest, defineCapability, forbidden, notFound, type Capability } from '@/lib/hub/core';
import { MCP_SHOPS, resolveShopScope, shopForAccount } from '@/lib/mcp/shops';
import {
  ATTRIBUTIONS, LEVELS, SORT_KEYS, DATE_RE, DEFAULT_FATIGUE, NO_CREATIVE_KEY,
  type Attribution, type Metrics,
  compareBy, daysBetweenInclusive, emptyTotals, addRow, fatigueVerdict, finalize, groupRows,
  pct, previousRange, shiftDays,
} from '@/lib/mcp/metrics';
import { allTags, fetchAdRows, fetchCreatives, imageFor, latestDataDate, thumbnailFor, type CreativeRow } from '@/lib/mcp/data';

// Zdolności Data Hub: reklamy Meta (wyniki, zmęczenie kreacji, kreacje,
// kampanie), materiały ze Studio i stan danych. Wystawiane jako REST
// /api/v1/<path> i narzędzia MCP o tej samej nazwie (patrz src/lib/hub/core.ts).

const MAX_RANGE_DAYS = 400;
const shopSchema = z.enum(MCP_SHOPS).optional().describe('Sklep: mybed.pl | mybed.de | mojepostel.cz | mittohome.pl | nomosleep.pl. Brak = wszystkie dostępne.');
const dateSchema = z.string().regex(DATE_RE, 'Format YYYY-MM-DD');

function checkRange(from: string, to: string) {
  if (from > to) throw badRequest('date_from nie może być późniejsze niż date_to.');
  if (daysBetweenInclusive(from, to) > MAX_RANGE_DAYS) throw badRequest(`Maksymalny zakres to ${MAX_RANGE_DAYS} dni.`);
}

const DEFINITIONS = {
  currency: 'PLN (konta EUR przeliczone po kursie NBP z dnia emisji)',
  ctr: 'clicks / impressions × 100',
  roas: 'conversion_value / spend (wybrane okno atrybucji)',
  cpa: 'spend / conversions (wybrane okno atrybucji)',
  hook_rate: 'video_play_3s / impressions × 100',
  hold_rate: 'thruplays / video_play_3s × 100',
  video_curve: '% odtworzeń 3 s, które dotarły do p25…p100',
  reach_frequency: 'reach = suma dziennych reach (Meta deduplikuje tylko w obrębie dnia); frequency = impressions / ta suma, czyli średnia dzienna częstotliwość',
};

function changeBlock(curr: Metrics, prev: Metrics | null) {
  if (!prev) return { previous: null, spend_pct: null, roas_pct: null, cpa_pct: null, ctr_pct: null };
  return {
    previous: { spend: prev.spend, roas: prev.roas, cpa: prev.cpa, ctr: prev.ctr },
    spend_pct: pct(curr.spend, prev.spend),
    roas_pct: pct(curr.roas, prev.roas),
    cpa_pct: pct(curr.cpa, prev.cpa),
    ctr_pct: pct(curr.ctr, prev.ctr),
  };
}

function attributionWarning(defaultConv: number, chosenConv: number, attribution: Attribution): string | null {
  if (chosenConv === 0 && defaultConv > 0) {
    return `Okno ${attribution} ma 0 konwersji, a domyślne okno konta ${defaultConv} — dane atrybucji mogą nie być pobrane dla tego okresu.`;
  }
  return null;
}

function compactCreative(db: SupabaseClient, c: CreativeRow | undefined) {
  if (!c) return null;
  const thumb = thumbnailFor(db, c);
  return {
    creative_id: c.creative_id,
    format: c.format,
    title: c.title,
    thumbnail_url: thumb.url,
    thumbnail_source: thumb.source,
    is_dynamic: !!c.is_dynamic,
  };
}

export const adsCapabilities: Capability[] = [
  // ── 1. ads_performance ─────────────────────────────────
  defineCapability({
    name: 'ads_performance',
    path: 'ads/performance',
    tag: 'Reklamy Meta',
    title: 'Wyniki reklam Meta',
    description: 'Metryki reklam Meta na poziomie kampanii, zestawu, reklamy albo kreacji za okres, ze zmianą względem poprzedniego okresu tej samej długości. Kwoty w PLN.',
    input: {
      shop: shopSchema,
      date_from: dateSchema,
      date_to: dateSchema,
      level: z.enum(LEVELS).default('campaign'),
      attribution: z.enum(ATTRIBUTIONS).default('7d_click'),
      min_spend: z.number().min(0).optional().describe('Minimalny wydatek w okresie (PLN).'),
      sort_by: z.enum(SORT_KEYS).default('spend').describe('CPA sortowane rosnąco, reszta malejąco.'),
      limit: z.number().int().min(1).max(200).default(50),
    },
    run: async ({ db, auth }, a) => {
    checkRange(a.date_from, a.date_to);
    const scope = resolveShopScope(a.shop, auth.allowedShops);
    const prev = previousRange(a.date_from, a.date_to);
    const [rows, prevRows] = await Promise.all([
      fetchAdRows(db, { accountIds: scope.accountIds, from: a.date_from, to: a.date_to }),
      fetchAdRows(db, { accountIds: scope.accountIds, from: prev.from, to: prev.to }),
    ]);
    const groups = groupRows(rows, a.level, a.attribution);
    const prevGroups = groupRows(prevRows, a.level, a.attribution);

    const creativeIds = a.level === 'creative' ? [...groups.keys()].filter(k => k !== NO_CREATIVE_KEY) : [];
    const creatives = creativeIds.length ? await fetchCreatives(db, creativeIds) : new Map<string, CreativeRow>();

    const items = [...groups.values()]
      .map(g => ({ g, m: finalize(g.totals) }))
      .filter(({ m }) => a.min_spend == null || m.spend >= a.min_spend)
      .sort((x, y) => compareBy(a.sort_by)(x.m, y.m))
      .slice(0, a.limit)
      .map(({ g, m }) => {
        const prevGroup = prevGroups.get(g.key);
        const s = g.sample;
        const ident: Record<string, unknown> = { shop: shopForAccount(s.account_id) };
        if (a.level === 'campaign') Object.assign(ident, { campaign_id: s.campaign_id, campaign_name: s.campaign_name });
        if (a.level === 'adset') Object.assign(ident, { adset_id: s.adset_id, adset_name: s.adset_name, campaign_id: s.campaign_id, campaign_name: s.campaign_name });
        if (a.level === 'ad') Object.assign(ident, { ad_id: s.ad_id, ad_name: s.ad_name, adset_id: s.adset_id, adset_name: s.adset_name, campaign_id: s.campaign_id, campaign_name: s.campaign_name, creative_id: s.creative_id });
        if (a.level === 'creative') {
          Object.assign(ident, g.key === NO_CREATIVE_KEY
            ? { creative_id: null, note: 'Wiersze bez creative_id' }
            : { ...compactCreative(db, creatives.get(g.key)), creative_id: g.key });
          Object.assign(ident, { ads_count: g.adIds.size, adsets_count: g.adsetIds.size, campaigns_count: g.campaignIds.size });
        }
        return { ...ident, ...m, change: changeBlock(m, prevGroup ? finalize(prevGroup.totals) : null) };
      });

    const total = emptyTotals();
    for (const r of rows) addRow(total, r, a.attribution);
    const prevTotal = emptyTotals();
    for (const r of prevRows) addRow(prevTotal, r, a.attribution);
    const totalM = finalize(total);

    const warnings = [...scope.warnings];
    const aw = attributionWarning(total.defaultConversions, total.conversions, a.attribution);
    if (aw) warnings.push(aw);
    if (a.level === 'creative' && groups.has(NO_CREATIVE_KEY)) {
      const noCr = finalize(groups.get(NO_CREATIVE_KEY)!.totals).spend;
      const share = totalM.spend > 0 ? Math.round((noCr / totalM.spend) * 100) : 0;
      warnings.push(`${noCr} PLN wydatku (${share}% okresu) bez przypisanego creative_id.`);
    }

    return {
      rows: items.length,
      payload: {
        period: { from: a.date_from, to: a.date_to },
        previous_period: prev,
        level: a.level,
        attribution: a.attribution,
        shops: scope.shops,
        totals: { ...totalM, change: changeBlock(totalM, prevRows.length ? finalize(prevTotal) : null) },
        rows_total: groups.size,
        rows: items,
        warnings,
        definitions: DEFINITIONS,
      },
    };
    },
  }),

  // ── 2. creative_fatigue ────────────────────────────────
  defineCapability({
    name: 'creative_fatigue',
    path: 'ads/fatigue',
    tag: 'Reklamy Meta',
    title: 'Zmęczenie kreacji',
    description: 'Reklamy ze zmęczeniem: frequency > 3 i spadek CTR > 20% okno do okna, albo wzrost CPA > 30%. Okna liczone od ostatniego dnia z danymi.',
    input: {
      shop: shopSchema,
      window_days: z.number().int().min(3).max(60).default(7),
      min_spend: z.number().min(0).default(500).describe('Minimalny wydatek w bieżącym oknie (PLN).'),
      attribution: z.enum(ATTRIBUTIONS).default('7d_click'),
    },
    run: async ({ db, auth }, a) => {
    const scope = resolveShopScope(a.shop, auth.allowedShops);
    const last = await latestDataDate(db, scope.accountIds);
    if (!last) return { rows: 0, payload: { rows: [], warnings: [...scope.warnings, 'Brak danych reklam dla zakresu.'] } };
    const curr = { from: shiftDays(last, -(a.window_days - 1)), to: last };
    const prev = previousRange(curr.from, curr.to);
    const rows = await fetchAdRows(db, { accountIds: scope.accountIds, from: prev.from, to: curr.to });
    const currRows = rows.filter(r => r.date >= curr.from);
    const prevRows = rows.filter(r => r.date < curr.from);
    const currG = groupRows(currRows, 'ad', a.attribution);
    const prevG = groupRows(prevRows, 'ad', a.attribution);

    const flagged = [...currG.values()]
      .map(g => ({ g, m: finalize(g.totals), p: prevG.get(g.key) }))
      .filter(x => x.m.spend >= a.min_spend && x.p)
      .map(x => ({ ...x, pm: finalize(x.p!.totals) }))
      .map(x => ({ ...x, v: fatigueVerdict(x.m, x.pm, DEFAULT_FATIGUE) }))
      .filter(x => x.v.fatigued)
      .sort((x, y) => y.m.spend - x.m.spend)
      .slice(0, 100);

    // Dni aktywności w całej historii reklamy (dni z wydatkiem lub wyświetleniami).
    const activeDays = new Map<string, { days: Set<string>; first: string }>();
    if (flagged.length) {
      const hist = await fetchAdRows(db, { accountIds: scope.accountIds, from: shiftDays(last, -(MAX_RANGE_DAYS - 1)), to: last, adIds: flagged.map(f => f.g.key) });
      for (const r of hist) {
        if (!((r.spend || 0) > 0 || (r.impressions || 0) > 0)) continue;
        const e = activeDays.get(r.ad_id) || { days: new Set<string>(), first: r.date };
        e.days.add(r.date);
        if (r.date < e.first) e.first = r.date;
        activeDays.set(r.ad_id, e);
      }
    }
    const creatives = await fetchCreatives(db, flagged.map(f => f.g.sample.creative_id || '').filter(Boolean));

    const out = flagged.map(({ g, m, pm, v }) => {
      const s = g.sample;
      const life = activeDays.get(g.key);
      return {
        shop: shopForAccount(s.account_id),
        ad_id: s.ad_id, ad_name: s.ad_name,
        adset_name: s.adset_name, campaign_name: s.campaign_name,
        creative: compactCreative(db, s.creative_id ? creatives.get(s.creative_id) : undefined) ?? { creative_id: s.creative_id },
        reasons: v.reasons,
        ctr_change_pct: v.ctr_change_pct,
        cpa_change_pct: v.cpa_change_pct,
        current_window: m,
        previous_window: pm,
        days_active: life ? life.days.size : null,
        first_active_day: life ? life.first : null,
      };
    });

    return {
      rows: out.length,
      payload: {
        current_window: curr, previous_window: prev, attribution: a.attribution, shops: scope.shops,
        thresholds: DEFAULT_FATIGUE, rows: out,
        warnings: [...scope.warnings, 'frequency = średnia dzienna (suma dziennych reach) — to dolna granica częstotliwości w oknie, więc warunek frequency > 3 jest ostrożny.'],
        definitions: DEFINITIONS,
      },
    };
    },
  }),

  // ── 3. creatives_list ──────────────────────────────────
  defineCapability({
    name: 'creatives_list',
    path: 'creatives',
    tag: 'Reklamy Meta',
    title: 'Lista kreacji',
    description: 'Kreacje z wynikami w okresie (spend, ROAS, CPA, hook rate), tagami i stałym URL miniatury. Filtry: format, proporcje, tagi (wszystkie muszą wystąpić).',
    input: {
      shop: shopSchema,
      date_from: dateSchema,
      date_to: dateSchema,
      format: z.string().optional().describe('video | image | carousel | dynamic'),
      aspect_ratio: z.string().optional().describe('np. 1:1, 4:5, 9:16'),
      tags: z.array(z.string()).optional().describe('Tagi auto/AI/ręczne, np. ["angle:cena-promocja","style:ugc"]'),
      min_spend: z.number().min(0).optional(),
      attribution: z.enum(ATTRIBUTIONS).default('7d_click'),
      sort_by: z.enum(['spend', 'roas', 'cpa', 'hook_rate'] as const).default('spend'),
      limit: z.number().int().min(1).max(200).default(50),
    },
    run: async ({ db, auth }, a) => {
    checkRange(a.date_from, a.date_to);
    const scope = resolveShopScope(a.shop, auth.allowedShops);
    const rows = await fetchAdRows(db, { accountIds: scope.accountIds, from: a.date_from, to: a.date_to });
    const groups = groupRows(rows.filter(r => r.creative_id), 'creative', a.attribution);
    const creatives = await fetchCreatives(db, [...groups.keys()]);
    const wantTags = (a.tags || []).map(t => t.trim().toLowerCase()).filter(Boolean);

    const items = [...groups.values()]
      .map(g => ({ g, c: creatives.get(g.key), m: finalize(g.totals) }))
      .filter(({ c, m }) => {
        if (a.min_spend != null && m.spend < a.min_spend) return false;
        if (a.format && (c?.format || '').toLowerCase() !== a.format.toLowerCase()) return false;
        if (a.aspect_ratio && (c?.aspect_ratio || '') !== a.aspect_ratio) return false;
        if (wantTags.length) {
          const have = new Set((c ? allTags(c) : []).map(t => t.toLowerCase()));
          if (!wantTags.every(t => have.has(t))) return false;
        }
        return true;
      })
      .sort((x, y) => compareBy(a.sort_by)(x.m, y.m));

    const out = items.slice(0, a.limit).map(({ g, c, m }) => {
      const thumb = thumbnailFor(db, c);
      return {
        creative_id: g.key,
        shop: shopForAccount(g.sample.account_id),
        format: c?.format ?? null,
        aspect_ratio: c?.aspect_ratio ?? null,
        duration_sec: c?.duration_sec ?? null,
        title: c?.title ?? null,
        body: c?.body ?? null,
        cta: c?.call_to_action_type ?? null,
        thumbnail_url: thumb.url,
        thumbnail_source: thumb.source,
        ai_tags: c?.ai_tags ?? [],
        ai_tag_status: c?.ai_tag_status ?? null,
        manual_tags: c?.manual_tags ?? [],
        spend: m.spend, roas: m.roas, cpa: m.cpa, conversions: m.conversions, conversion_value: m.conversion_value,
        hook_rate: m.hook_rate, ctr: m.ctr, impressions: m.impressions,
        first_day: g.totals.firstDay, last_day: g.totals.lastDay,
        ads_count: g.adIds.size,
        is_dynamic: !!c?.is_dynamic,
        in_dim_creatives: !!c,
      };
    });
    const metaThumbs = out.filter(o => o.thumbnail_source === 'meta_cdn').length;
    const warnings = [...scope.warnings];
    if (metaThumbs) warnings.push(`${metaThumbs} miniatur to linki fbcdn (wygasają) — kopia w Storage jeszcze nie powstała.`);
    return {
      rows: out.length,
      payload: { period: { from: a.date_from, to: a.date_to }, attribution: a.attribution, shops: scope.shops, rows_total: items.length, rows: out, warnings, definitions: DEFINITIONS },
    };
    },
  }),

  // ── 4. creative_detail ─────────────────────────────────
  defineCapability({
    name: 'creative_detail',
    path: 'creatives/{creative_id}',
    tag: 'Reklamy Meta',
    title: 'Szczegóły kreacji',
    description: 'Pełne copy, obraz/wideo, permalink, analiza AI, dzienny szereg metryk i reklamy/zestawy/kampanie używające kreacji.',
    input: {
      creative_id: z.string().min(1),
      days: z.number().int().min(1).max(MAX_RANGE_DAYS).default(90).describe('Długość dziennego szeregu (dni wstecz od ostatnich danych).'),
      attribution: z.enum(ATTRIBUTIONS).default('7d_click'),
    },
    run: async ({ db, auth }, a) => {
    const scope = resolveShopScope(undefined, auth.allowedShops);
    const c = (await fetchCreatives(db, [a.creative_id])).get(a.creative_id);
    if (!c) throw notFound(`Nie znam kreacji ${a.creative_id}.`);
    if (!scope.accountIds.includes(c.account_id)) throw forbidden(`Brak dostępu do kreacji ${a.creative_id} (sklep ${shopForAccount(c.account_id)}).`);

    const last = (await latestDataDate(db, [c.account_id])) || new Date().toISOString().slice(0, 10);
    const from = shiftDays(last, -(a.days - 1));
    const rows = await fetchAdRows(db, { accountIds: [c.account_id], from, to: last, creativeId: a.creative_id });

    const byDay = new Map<string, ReturnType<typeof emptyTotals>>();
    for (const r of rows) {
      const t = byDay.get(r.date) || emptyTotals();
      addRow(t, r, a.attribution);
      byDay.set(r.date, t);
    }
    const daily = [...byDay.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([date, t]) => {
      const m = finalize(t);
      return { date, spend: m.spend, impressions: m.impressions, clicks: m.clicks, ctr: m.ctr, conversions: m.conversions, conversion_value: m.conversion_value, roas: m.roas, cpa: m.cpa, hook_rate: m.hook_rate };
    });
    const total = emptyTotals();
    for (const r of rows) addRow(total, r, a.attribution);

    const ads = [...groupRows(rows, 'ad', a.attribution).values()].map(g => ({
      ad_id: g.sample.ad_id, ad_name: g.sample.ad_name,
      adset_id: g.sample.adset_id, adset_name: g.sample.adset_name,
      campaign_id: g.sample.campaign_id, campaign_name: g.sample.campaign_name,
      ...(({ spend, roas, cpa, ctr }) => ({ spend, roas, cpa, ctr }))(finalize(g.totals)),
    })).sort((x, y) => y.spend - x.spend);

    const thumb = thumbnailFor(db, c);
    return {
      rows: daily.length,
      payload: {
        creative_id: c.creative_id,
        shop: shopForAccount(c.account_id),
        format: c.format, aspect_ratio: c.aspect_ratio, duration_sec: c.duration_sec, is_dynamic: !!c.is_dynamic,
        title: c.title, body: c.body, cta: c.call_to_action_type,
        thumbnail_url: thumb.url, thumbnail_source: thumb.source,
        image_url: imageFor(db, c),
        video_id: c.video_id,
        permalink_url: c.permalink_url,
        auto_tags: c.auto_tags ?? [], ai_tags: c.ai_tags ?? [], manual_tags: c.manual_tags ?? [],
        ai_tag_status: c.ai_tag_status, ai_insights: c.ai_insights, manual_notes: c.manual_notes,
        first_seen_at: c.first_seen_at, last_seen_at: c.last_seen_at,
        period: { from, to: last }, attribution: a.attribution,
        totals: finalize(total),
        daily,
        ads,
        campaigns: [...new Set(ads.map(x => x.campaign_id))].length,
        definitions: DEFINITIONS,
      },
    };
    },
  }),

  // ── 5. campaigns_list ──────────────────────────────────
  defineCapability({
    name: 'campaigns_list',
    path: 'campaigns',
    tag: 'Reklamy Meta',
    title: 'Lista kampanii',
    description: 'Kampanie Meta (cel, status, budżet, etap lejka, tagi) z wydatkiem i ROAS z ostatnich 7 i 30 dni.',
    input: {
      shop: shopSchema,
      status: z.string().regex(/^[A-Za-z_]+$/).optional().describe('np. ACTIVE, PAUSED (porównywane ze status i effective_status)'),
      funnel_stage: z.string().optional().describe('TOFU | MOFU | BOFU | Retargeting | Retencja'),
      attribution: z.enum(ATTRIBUTIONS).default('7d_click'),
    },
    run: async ({ db, auth }, a) => {
    const scope = resolveShopScope(a.shop, auth.allowedShops);
    if (scope.accountIds.length === 0) return { rows: 0, payload: { rows: [], warnings: scope.warnings } };
    let q = db.from('dim_campaigns')
      .select('campaign_id, account_id, name, objective, status, effective_status, daily_budget, lifetime_budget, start_time, stop_time, purpose, funnel_stage, notes, manual_tags, last_seen_at')
      .in('account_id', scope.accountIds)
      .order('last_seen_at', { ascending: false })
      .limit(1000);
    if (a.funnel_stage) q = q.eq('funnel_stage', a.funnel_stage);
    if (a.status) q = q.or(`status.eq.${a.status.toUpperCase()},effective_status.eq.${a.status.toUpperCase()}`);
    const { data: campaigns, error } = await q;
    if (error) throw new Error(`dim_campaigns: ${error.message}`);

    const last = await latestDataDate(db, scope.accountIds);
    const rows = last ? await fetchAdRows(db, { accountIds: scope.accountIds, from: shiftDays(last, -29), to: last }) : [];
    const from7 = last ? shiftDays(last, -6) : '';
    const g30 = groupRows(rows, 'campaign', a.attribution);
    const g7 = groupRows(rows.filter(r => r.date >= from7), 'campaign', a.attribution);

    const out = (campaigns || []).map(c => {
      const m30 = g30.get(c.campaign_id as string);
      const m7 = g7.get(c.campaign_id as string);
      const f30 = m30 ? finalize(m30.totals) : null;
      const f7 = m7 ? finalize(m7.totals) : null;
      return {
        ...c,
        shop: shopForAccount(c.account_id as string),
        budget_currency: c.account_id === 'act_637792865917248' ? 'EUR' : 'PLN',
        last_7d: f7 ? { spend: f7.spend, roas: f7.roas, cpa: f7.cpa } : { spend: 0, roas: null, cpa: null },
        last_30d: f30 ? { spend: f30.spend, roas: f30.roas, cpa: f30.cpa } : { spend: 0, roas: null, cpa: null },
      };
    }).sort((x, y) => y.last_30d.spend - x.last_30d.spend);

    return {
      rows: out.length,
      payload: {
        data_until: last, attribution: a.attribution, shops: scope.shops, rows: out,
        warnings: [...scope.warnings, 'Budżety w walucie konta (mybed.de: EUR); wydatki i ROAS w PLN.'],
      },
    };
    },
  }),

  // ── 6. assets_search ───────────────────────────────────
  defineCapability({
    name: 'assets_search',
    path: 'assets',
    tag: 'Materiały',
    title: 'Szukaj materiałów',
    description: 'Szuka packshotów (nazwa pliku, wymiary np. „1080x1080”) i scen lifestyle z MyBed Studio. Zwraca podpisane URL-e ważne 24 h.',
    input: {
      query: z.string().min(1),
      type: z.enum(['packshot', 'lifestyle', 'video'] as const).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    },
    // Materiały marki nie są przypisane do sklepu — dostępne dla każdego ważnego tokenu.
    run: async ({ db }, a) => {
    // Znaki specjalne filtra PostgREST (`,` `(` `)` `"` `\`) i LIKE (`%` `_`) wycinamy z frazy.
    const term = a.query.replace(/[%_,()"\\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!term) throw badRequest('Pusta fraza wyszukiwania.');
    const dims = /(\d{2,5})\s*[x×]\s*(\d{2,5})/i.exec(a.query);
    const out: Array<Record<string, unknown>> = [];
    const warnings: string[] = [];
    const SIGN_TTL = 24 * 60 * 60;

    async function sign(bucket: string, paths: string[]): Promise<Map<string, string>> {
      const map = new Map<string, string>();
      if (!paths.length) return map;
      const { data, error } = await db.storage.from(bucket).createSignedUrls(paths, SIGN_TTL);
      if (error) { warnings.push(`${bucket}: ${error.message}`); return map; }
      for (const d of data || []) if (d.path && d.signedUrl) map.set(d.path, d.signedUrl);
      return map;
    }

    if (!a.type || a.type === 'packshot') {
      let q = db.from('packshots').select('id, storage_path, original_filename, width, height, created_at').is('deleted_at', null).order('created_at', { ascending: false }).limit(a.limit);
      if (dims) q = q.eq('width', Number(dims[1])).eq('height', Number(dims[2]));
      else q = q.or(`original_filename.ilike.%${term}%,storage_path.ilike.%${term}%`);
      const { data, error } = await q;
      if (error) warnings.push(`packshots: ${error.message}`);
      const urls = await sign('packshots', (data || []).map(p => p.storage_path as string));
      for (const p of data || []) out.push({ type: 'packshot', id: p.id, name: p.original_filename, width: p.width, height: p.height, created_at: p.created_at, url: urls.get(p.storage_path as string) ?? null });
    }

    if (!a.type || a.type === 'lifestyle') {
      let q = db.from('generations').select('id, storage_path, style_text, edit_instruction, width, height, created_at').eq('status', 'done').not('storage_path', 'is', null).order('created_at', { ascending: false }).limit(a.limit);
      if (dims) q = q.eq('width', Number(dims[1])).eq('height', Number(dims[2]));
      else q = q.or(`style_text.ilike.%${term}%,edit_instruction.ilike.%${term}%,storage_path.ilike.%${term}%`);
      const { data, error } = await q;
      if (error) warnings.push(`generations: ${error.message}`);
      const urls = await sign('generations', (data || []).map(g => g.storage_path as string));
      for (const g of data || []) out.push({ type: 'lifestyle', id: g.id, description: g.style_text || g.edit_instruction, width: g.width, height: g.height, created_at: g.created_at, url: urls.get(g.storage_path as string) ?? null });
    }

    if (a.type === 'video') warnings.push('Brak indeksu wideo — filmy nie są jeszcze w Storage (planowany indeks z Google Drive i Figmy).');

    return { rows: out.length, payload: { query: a.query, rows: out.slice(0, a.limit), url_ttl_hours: 24, warnings } };
    },
  }),

  // ── 7. data_health ─────────────────────────────────────
  defineCapability({
    name: 'data_health',
    path: 'health',
    tag: 'System',
    title: 'Stan danych',
    description: 'Stan danych Data Hub: ostatni dzień sprzedaży ERP, GA4, showroomów i reklam Meta per konto, % wierszy bez creative_id (30 dni), kreacje bez tagów AI i bez kopii miniatury, ostatnie udane i nieudane przebiegi ETL.',
    input: { shop: shopSchema },
    run: async ({ db, auth }, a) => {
    const scope = resolveShopScope(a.shop, auth.allowedShops);
    const today = new Date().toISOString().slice(0, 10);
    const from30 = shiftDays(today, -30);

    const accounts = await Promise.all(scope.accountIds.map(async accountId => {
      const lastDate = await latestDataDate(db, [accountId]);
      const [{ count: total }, { count: noCreative }] = await Promise.all([
        db.from('fact_daily_ad_performance').select('ad_id', { count: 'exact', head: true }).eq('platform', 'meta').eq('account_id', accountId).gte('date', from30),
        db.from('fact_daily_ad_performance').select('ad_id', { count: 'exact', head: true }).eq('platform', 'meta').eq('account_id', accountId).gte('date', from30).is('creative_id', null),
      ]);
      return {
        shop: shopForAccount(accountId), account_id: accountId, last_date: lastDate,
        lag_days: lastDate ? daysBetweenInclusive(lastDate, today) - 1 : null,
        rows_30d: total ?? 0, rows_30d_without_creative: noCreative ?? 0,
        pct_without_creative: total ? Math.round(((noCreative ?? 0) / total) * 1000) / 10 : null,
      };
    }));

    const statusCounts: Record<string, number> = {};
    let withoutStoredThumb = 0;
    if (scope.accountIds.length) {
      for (const status of ['pending', 'processing', 'completed', 'failed', 'skipped']) {
        const { count } = await db.from('dim_creatives').select('creative_id', { count: 'exact', head: true }).in('account_id', scope.accountIds).eq('ai_tag_status', status);
        statusCounts[status] = count ?? 0;
      }
      const { count } = await db.from('dim_creatives').select('creative_id', { count: 'exact', head: true }).in('account_id', scope.accountIds).is('thumb_storage_path', null);
      withoutStoredThumb = count ?? 0;
    }

    const SOURCES = ['gdrive_csv', 'ga4', 'meta_ads', 'meta_ads_adlevel', 'creative_tagging', 'creative_thumbs', 'creative_backfill'];
    const { data: errors } = await db.from('etl_log')
      .select('source, status, started_at, error_message')
      .in('source', SOURCES).in('status', ['error', 'failed'])
      .order('started_at', { ascending: false }).limit(10);
    const lastSuccess: Record<string, string | null> = {};
    for (const source of SOURCES) {
      const { data } = await db.from('etl_log').select('finished_at').eq('source', source).eq('status', 'success').order('finished_at', { ascending: false }).limit(1).maybeSingle();
      lastSuccess[source] = (data?.finished_at as string) ?? null;
    }

    // Świeżość pozostałych źródeł Data Hub (sprzedaż ERP, GA4, showroomy).
    const latest = async (table: string, column: string, filter?: [string, string]) => {
      let q = db.from(table).select(column).order(column, { ascending: false }).limit(1);
      if (filter) q = q.eq(filter[0], filter[1]);
      const { data } = await q.maybeSingle();
      const v = (data as Record<string, unknown> | null)?.[column];
      return v ? String(v).slice(0, 10) : null;
    };
    const [lastOrder, lastGa4, lastShowroomSales, lastVisits] = await Promise.all([
      latest('fact_orders', 'order_date'),
      latest('fact_daily_traffic', 'date', ['source', '__total__']),
      latest('sensmax_showroom_sales', 'date'),
      latest('sensmax_hourly_visits', 'date'),
    ]);

    return {
      rows: accounts.length,
      payload: {
        today, shops: scope.shops,
        sources_last_date: {
          sales_erp_orders: lastOrder,
          traffic_ga4: lastGa4,
          showroom_sales_sheets: lastShowroomSales,
          showroom_visitors_sensmax: lastVisits,
        },
        accounts,
        creatives_ai_tag_status: statusCounts,
        creatives_without_stored_thumbnail: withoutStoredThumb,
        etl_last_success: lastSuccess,
        etl_recent_errors: (errors || []).map(e => ({ ...e, error_message: e.error_message ? String(e.error_message).slice(0, 300) : null })),
        warnings: scope.warnings,
      },
    };
    },
  }),
];
