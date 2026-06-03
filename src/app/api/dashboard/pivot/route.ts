import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  measureDataset, META_ACCOUNT_TO_SHOP,
  ALLOWED_X_AXES, ALLOWED_Y_AXES, FILTERABLE_FIELDS,
  type Dataset, type PivotMetric, type PivotFormat,
  type AdvancedFilter,
} from '@/lib/explorer-whitelist';
import { fetchEurRatesByDate, gaToPln } from '@/lib/ad-cost';
import { applySbFilters, type ExplorerFilter } from '@/lib/explorer-filters';
import { evaluateFormula, validateFormula } from '@/lib/pivot-formula';
import { getTemplate, evaluateTemplate, PIVOT_TEMPLATES } from '@/lib/pivot-templates';

// Wymiary obsługiwane w pivot (MVP). Item-level dims (product_category itd.)
// celowo poza scope — wymagają dociągania v_order_items per wymiar.
const PIVOT_ROW_DIMS = new Set([
  'date', 'source_shop', 'source_platform', 'campaign', 'service_type',
  'supplier', 'status', 'delivery_city', 'coupon_code',
]);

// Granulacja ma sens tylko dla wymiaru 'date'.
type Granularity = 'day' | 'week' | 'month' | 'quarter';

interface PivotInput {
  row_dims: string[];
  metrics: PivotMetric[];
  granularity: Granularity;
  date_from: string;
  date_to: string;
  filters_advanced: AdvancedFilter[];
  filters?: Record<string, string[]>;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const row_dims = Array.isArray(body.row_dims) ? body.row_dims.map(String) : [];
    const metrics: PivotMetric[] = Array.isArray(body.metrics) ? body.metrics : [];
    const granularity: Granularity = (['day', 'week', 'month', 'quarter'] as const)
      .includes(body.granularity) ? body.granularity : 'month';
    const date_from = String(body.date_from || '2025-01-01');
    const date_to = String(body.date_to || new Date().toISOString().split('T')[0]);
    const filters_advanced: AdvancedFilter[] = Array.isArray(body.filters_advanced) ? body.filters_advanced : [];
    const shopFilter = Array.isArray(body.filters?.shop) ? body.filters.shop as string[] : [];

    // ── Walidacja ──
    if (row_dims.length === 0) return NextResponse.json({ error: 'row_dims jest wymagane' }, { status: 400 });
    for (const d of row_dims) {
      if (!ALLOWED_X_AXES.includes(d) || !PIVOT_ROW_DIMS.has(d)) {
        return NextResponse.json({ error: `Niedozwolony wymiar pivot: ${d}` }, { status: 400 });
      }
    }
    if (metrics.length === 0) return NextResponse.json({ error: 'metrics jest wymagane' }, { status: 400 });

    // Zbierz nazwy raw + template żeby zwalidować computed expr.
    const rawKeys = metrics.filter((m): m is Extract<PivotMetric, { kind: 'raw' }> => m.kind === 'raw').map(m => m.key);
    const templateKeys = metrics.filter((m): m is Extract<PivotMetric, { kind: 'template' }> => m.kind === 'template').map(m => m.template);
    const computedLabels = metrics.filter((m): m is Extract<PivotMetric, { kind: 'computed' }> => m.kind === 'computed').map(m => m.label);

    for (const m of metrics) {
      if (m.kind === 'raw' && !ALLOWED_Y_AXES.includes(m.key)) {
        return NextResponse.json({ error: `Niedozwolona metryka raw: ${m.key}` }, { status: 400 });
      }
      if (m.kind === 'template' && !getTemplate(m.template)) {
        return NextResponse.json({ error: `Niedozwolony template: ${m.template}` }, { status: 400 });
      }
      if (m.kind === 'computed') {
        // Wszystkie raw + templates + wcześniej zdefiniowane computed = whitelist.
        const allowed = new Set<string>([
          ...ALLOWED_Y_AXES,
          ...rawKeys,
          ...templateKeys,
          ...computedLabels,
        ]);
        const errs = validateFormula(m.expr, [...allowed]);
        if (errs.length) {
          return NextResponse.json({ error: `Formuła "${m.label}": ${errs.join('; ')}` }, { status: 400 });
        }
      }
    }
    for (const f of filters_advanced) {
      if (!FILTERABLE_FIELDS.includes(f.field)) {
        return NextResponse.json({ error: `Niedozwolone pole filtra: ${f.field}` }, { status: 400 });
      }
    }

    const input: PivotInput = { row_dims, metrics, granularity, date_from, date_to, filters_advanced, filters: { shop: shopFilter } };

    // Dla każdej raw metryki znajdź dataset. Puszczamy 1 zapytanie per dataset
    // (po unionie metryk z tego datasetu).
    const datasetsNeeded = new Set<Dataset>();
    for (const m of metrics) {
      if (m.kind !== 'raw') continue;
      datasetsNeeded.add(measureDataset(m.key));
    }

    // Każdy dataset zwraca { key -> { metric -> value } }, klucz scalony z row_dims.
    const merged: Record<string, Record<string, number>> = {};
    const dimsByKey: Record<string, string[]> = {};

    function merge(rowsByKey: Record<string, Record<string, number>>, dimsForKey: Record<string, string[]>) {
      for (const key of Object.keys(rowsByKey)) {
        if (!merged[key]) merged[key] = {};
        Object.assign(merged[key], rowsByKey[key]);
        if (!dimsByKey[key]) dimsByKey[key] = dimsForKey[key];
      }
    }

    if (datasetsNeeded.has('orders')) merge(...await runOrders(input));
    if (datasetsNeeded.has('meta')) merge(...await runMeta(input));
    if (datasetsNeeded.has('traffic')) merge(...await runTraffic(input));
    if (datasetsNeeded.has('agency')) merge(...await runAgency(input));

    // Templates i computed — po scaleniu wierszy.
    const rowsOut = Object.keys(merged).sort().map(key => {
      const scope = { ...merged[key] };
      // Wypełnij zero dla raw kluczy które jakiś dataset by zwrócił, ale wiersz nie ma.
      for (const k of rawKeys) if (scope[k] == null) scope[k] = 0;
      const valuesOrdered: Record<string, number> = {};
      for (const m of metrics) {
        if (m.kind === 'raw') valuesOrdered[m.key] = scope[m.key] || 0;
        else if (m.kind === 'template') {
          const v = evaluateTemplate(m.template, scope);
          valuesOrdered[m.label || getTemplate(m.template)?.label || m.template] = v;
          // Udostępniamy także po kluczu templatey w scope dla computed.
          scope[m.template] = v;
        } else {
          const v = evaluateFormula(m.expr, scope);
          valuesOrdered[m.label] = v;
          scope[m.label] = v;
        }
      }
      return { dim_values: dimsByKey[key] || key.split('|'), metrics: valuesOrdered };
    });

    // Totals — sumy raw, recompute template/computed na sumach.
    const totals: Record<string, number> = {};
    const totalsScope: Record<string, number> = {};
    for (const k of rawKeys) {
      totalsScope[k] = rowsOut.reduce((s, r) => s + (Number(r.metrics[k]) || 0), 0);
    }
    for (const m of metrics) {
      let label: string;
      let v: number;
      if (m.kind === 'raw') { label = m.key; v = totalsScope[m.key] || 0; }
      else if (m.kind === 'template') {
        label = m.label || getTemplate(m.template)?.label || m.template;
        v = evaluateTemplate(m.template, totalsScope);
        totalsScope[m.template] = v;
      } else {
        label = m.label;
        v = evaluateFormula(m.expr, totalsScope);
        totalsScope[label] = v;
      }
      totals[label] = v;
    }

    // Schemat kolumn (label + format) — pomocniczy do renderowania.
    const columns = metrics.map(m => columnDef(m));

    return NextResponse.json({
      row_dims,
      columns,
      rows: rowsOut,
      totals,
      meta: { date_range: { from: date_from, to: date_to }, granularity, total_rows: rowsOut.length },
    });
  } catch (err) {
    console.error('Pivot API error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function columnDef(m: PivotMetric): { key: string; label: string; format: PivotFormat } {
  if (m.kind === 'raw') return { key: m.key, label: m.label || m.key, format: m.format || defaultRawFormat(m.key) };
  if (m.kind === 'template') {
    const t = getTemplate(m.template);
    return { key: m.label || t?.label || m.template, label: m.label || t?.label || m.template, format: m.format || t?.format || 'number' };
  }
  return { key: m.label, label: m.label, format: m.format || 'number' };
}

function defaultRawFormat(key: string): PivotFormat {
  if (key.endsWith('_ctr') || key === 'conv_rate') return 'pct';
  if (key.endsWith('_roas')) return 'ratio';
  if (
    key.startsWith('revenue') || key.endsWith('_spend') || key.endsWith('_revenue') ||
    key === 'avg_order_value' || key === 'agency_cost' || key === 'shipping_revenue' ||
    key === 'ga_revenue' || key === 'meta_cpc'
  ) return 'pln';
  return 'number';
}

// ── Granulacja daty ────────────────────────────────────────────────
function dateKey(dateStr: string, g: Granularity): string {
  const d = new Date(dateStr);
  switch (g) {
    case 'week': {
      const sw = new Date(d);
      sw.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return sw.toISOString().split('T')[0];
    }
    case 'month': return dateStr.substring(0, 7);
    case 'quarter': return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    default: return dateStr.substring(0, 10);
  }
}

function makeKey(values: string[]): string { return values.join('|'); }

function ensureRow(
  acc: { rowsByKey: Record<string, Record<string, number>>; dimsForKey: Record<string, string[]> },
  values: string[],
): Record<string, number> {
  const key = makeKey(values);
  if (!acc.rowsByKey[key]) acc.rowsByKey[key] = {};
  if (!acc.dimsForKey[key]) acc.dimsForKey[key] = values;
  return acc.rowsByKey[key];
}

// ── Dataset: orders (fact_orders) ─────────────────────────────────
async function runOrders(input: PivotInput): Promise<[Record<string, Record<string, number>>, Record<string, string[]>]> {
  const db = getSupabaseAdmin();
  let q = db.from('fact_orders')
    .select('order_id, order_date, source_shop, source_platform, supplier, status, delivery_city, coupon_code, total_gross_pln, shipping_cost_pln, is_paid')
    .gte('order_date', input.date_from)
    .lte('order_date', input.date_to + 'T23:59:59');
  if (input.filters?.shop?.length) q = q.in('source_shop', input.filters.shop);
  q = applySbFilters(q as never, input.filters_advanced as ExplorerFilter[],
    ['source_shop', 'source_platform', 'supplier', 'status', 'delivery_city', 'coupon_code', 'total_gross_pln']);
  const { data, error } = await q.limit(50000);
  if (error) throw new Error(error.message);

  const acc = { rowsByKey: {} as Record<string, Record<string, number>>, dimsForKey: {} as Record<string, string[]> };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function dimVal(d: string, r: any): string {
    switch (d) {
      case 'date': return dateKey(String(r.order_date), input.granularity);
      case 'source_shop': return String(r.source_shop || 'unknown');
      case 'source_platform': return String(r.source_platform || 'unknown');
      case 'supplier': return String(r.supplier || 'Brak');
      case 'status': return String(r.status || 'unknown');
      case 'delivery_city': return String(r.delivery_city || 'Brak');
      case 'coupon_code': return String(r.coupon_code || 'Brak');
      default: return 'Łącznie';
    }
  }

  // Per-order grouping: jeden wiersz fact_orders => jeden bucket (klucz = row_dims).
  // Track unique orderIds per bucket żeby liczyć orders_count / avg_order_value bez duplikatów.
  const orderIdsBucket: Record<string, Set<string>> = {};
  for (const r of data || []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = r as any;
    const values = input.row_dims.map(d => dimVal(d, row));
    const bucket = ensureRow(acc, values);
    const key = makeKey(values);
    if (!orderIdsBucket[key]) orderIdsBucket[key] = new Set();
    if (orderIdsBucket[key].has(row.order_id)) continue;
    orderIdsBucket[key].add(row.order_id);

    const gross = Number(row.total_gross_pln) || 0;
    const ship = Number(row.shipping_cost_pln) || 0;
    bucket.revenue_gross = (bucket.revenue_gross || 0) + gross;
    bucket.shipping_revenue = (bucket.shipping_revenue || 0) + ship;
    if (row.is_paid) {
      bucket.revenue_paid = (bucket.revenue_paid || 0) + gross;
      bucket.orders_paid = (bucket.orders_paid || 0) + 1;
    }
    if (typeof row.status === 'string' && /cancel|anulow/i.test(row.status)) {
      bucket.orders_cancelled = (bucket.orders_cancelled || 0) + 1;
    }
    bucket.orders_count = (bucket.orders_count || 0) + 1;
  }
  // AOV per bucket
  for (const key of Object.keys(acc.rowsByKey)) {
    const b = acc.rowsByKey[key];
    b.avg_order_value = b.orders_count > 0 ? (b.revenue_gross || 0) / b.orders_count : 0;
  }
  return [acc.rowsByKey, acc.dimsForKey];
}

// ── Dataset: meta (fact_daily_adspend) ────────────────────────────
async function runMeta(input: PivotInput): Promise<[Record<string, Record<string, number>>, Record<string, string[]>]> {
  const db = getSupabaseAdmin();
  const needsCampaign = input.row_dims.includes('campaign');
  let q = needsCampaign
    ? db.from('fact_daily_adspend').select('date, account_id, spend, conversion_value, impressions, clicks, conversions, campaign_name, campaign_id')
    : db.from('fact_daily_adspend').select('date, account_id, spend, conversion_value, impressions, clicks, conversions');
  q = q.eq('platform', 'meta').gte('date', input.date_from).lte('date', input.date_to);
  if (input.filters?.shop?.length) {
    const accts = Object.entries(META_ACCOUNT_TO_SHOP)
      .filter(([, shop]) => input.filters!.shop!.includes(shop))
      .map(([id]) => id);
    if (accts.length) q = q.in('account_id', accts);
    else return [{}, {}];
  }
  const { data, error } = await q.limit(50000);
  if (error) throw new Error(error.message);

  const acc = { rowsByKey: {} as Record<string, Record<string, number>>, dimsForKey: {} as Record<string, string[]> };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function dimVal(d: string, r: any): string {
    switch (d) {
      case 'date': return dateKey(String(r.date), input.granularity);
      case 'source_shop': return META_ACCOUNT_TO_SHOP[r.account_id] || 'Inne';
      case 'source_platform': return 'meta';
      case 'campaign': return String(r.campaign_name || r.campaign_id || '(unknown)');
      default: return 'Łącznie';
    }
  }

  for (const r of data || []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = r as any;
    const values = input.row_dims.map(d => dimVal(d, row));
    const bucket = ensureRow(acc, values);
    bucket.meta_spend = (bucket.meta_spend || 0) + (Number(row.spend) || 0);
    bucket.meta_revenue = (bucket.meta_revenue || 0) + (Number(row.conversion_value) || 0);
    bucket.meta_impressions = (bucket.meta_impressions || 0) + (Number(row.impressions) || 0);
    bucket.meta_clicks = (bucket.meta_clicks || 0) + (Number(row.clicks) || 0);
    bucket.meta_conversions = (bucket.meta_conversions || 0) + (Number(row.conversions) || 0);
  }
  // Pochodne meta (CTR, CPC, ROAS) — żeby były dostępne jako raw metrics jeśli ktoś wybierze.
  for (const key of Object.keys(acc.rowsByKey)) {
    const b = acc.rowsByKey[key];
    b.meta_ctr = b.meta_impressions > 0 ? (b.meta_clicks / b.meta_impressions) * 100 : 0;
    b.meta_cpc = b.meta_clicks > 0 ? b.meta_spend / b.meta_clicks : 0;
    b.meta_roas = b.meta_spend > 0 ? b.meta_revenue / b.meta_spend : 0;
  }
  return [acc.rowsByKey, acc.dimsForKey];
}

// ── Dataset: traffic (fact_daily_traffic) ─────────────────────────
async function runTraffic(input: PivotInput): Promise<[Record<string, Record<string, number>>, Record<string, string[]>]> {
  const db = getSupabaseAdmin();
  const needsCampaign = input.row_dims.includes('campaign');
  let q = needsCampaign
    ? db.from('fact_daily_traffic').select('date, hostname, sessions, users, transactions, ga_revenue, pageviews, ad_cost, campaign')
    : db.from('fact_daily_traffic').select('date, hostname, sessions, users, transactions, ga_revenue, pageviews, ad_cost');
  q = q.gte('date', input.date_from).lte('date', input.date_to);
  q = needsCampaign
    ? q.eq('source', 'google').eq('medium', 'cpc')
    : q.eq('source', '__total__');
  if (input.filters?.shop?.length) q = q.in('hostname', input.filters.shop);
  const { data, error } = await q.limit(50000);
  if (error) throw new Error(error.message);

  // EUR→PLN dla mybed.de.
  const rates = await fetchEurRatesByDate(db, input.date_from, input.date_to);

  const acc = { rowsByKey: {} as Record<string, Record<string, number>>, dimsForKey: {} as Record<string, string[]> };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function dimVal(d: string, r: any): string {
    switch (d) {
      case 'date': return dateKey(String(r.date), input.granularity);
      case 'source_shop': return String(r.hostname || 'unknown');
      case 'source_platform': return 'google';
      case 'campaign': return String(r.campaign || '(unknown)');
      default: return 'Łącznie';
    }
  }

  for (const r of data || []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = r as any;
    const values = input.row_dims.map(d => dimVal(d, row));
    const bucket = ensureRow(acc, values);
    const dateStr = String(row.date);
    bucket.sessions = (bucket.sessions || 0) + (Number(row.sessions) || 0);
    bucket.users = (bucket.users || 0) + (Number(row.users) || 0);
    bucket.transactions = (bucket.transactions || 0) + (Number(row.transactions) || 0);
    bucket.pageviews = (bucket.pageviews || 0) + (Number(row.pageviews) || 0);
    bucket.ga_revenue = (bucket.ga_revenue || 0) + gaToPln(row.hostname, Number(row.ga_revenue) || 0, dateStr, rates);
    bucket.google_spend = (bucket.google_spend || 0) + gaToPln(row.hostname, Number(row.ad_cost) || 0, dateStr, rates);
  }
  return [acc.rowsByKey, acc.dimsForKey];
}

// ── Dataset: agency (fact_agency_costs) ───────────────────────────
async function runAgency(input: PivotInput): Promise<[Record<string, Record<string, number>>, Record<string, string[]>]> {
  const db = getSupabaseAdmin();
  let q = db.from('fact_agency_costs')
    .select('month, agency_name, service_type, amount_pln, source_shop, platform')
    .gte('month', input.date_from)
    .lte('month', input.date_to);
  q = applySbFilters(q as never, input.filters_advanced as ExplorerFilter[],
    ['source_shop', 'platform', 'service_type']);
  if (input.filters?.shop?.length) q = q.in('source_shop', input.filters.shop);
  const { data, error } = await q.limit(5000);
  if (error) throw new Error(error.message);

  const acc = { rowsByKey: {} as Record<string, Record<string, number>>, dimsForKey: {} as Record<string, string[]> };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function dimVal(d: string, r: any): string {
    switch (d) {
      case 'date': return dateKey(String(r.month), input.granularity);
      case 'source_shop': return String(r.source_shop || 'Ogólne');
      case 'source_platform': return String(r.platform || 'Inne');
      case 'service_type': return String(r.service_type || 'Brak');
      default: return 'Łącznie';
    }
  }

  for (const r of data || []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = r as any;
    const values = input.row_dims.map(d => dimVal(d, row));
    const bucket = ensureRow(acc, values);
    bucket.agency_cost = (bucket.agency_cost || 0) + (Number(row.amount_pln) || 0);
  }
  return [acc.rowsByKey, acc.dimsForKey];
}

// Lista templates — endpoint pomocniczy dla UI.
export async function GET() {
  return NextResponse.json({
    templates: PIVOT_TEMPLATES.map(t => ({ key: t.key, label: t.label, format: t.format, expr: t.expr })),
  });
}
