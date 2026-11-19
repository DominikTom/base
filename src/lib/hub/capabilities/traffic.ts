import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { defineCapability, type Capability } from '@/lib/hub/core';
import { GROUPINGS, bucketKey, checkRange, dateSchema, ratio, round2, rpcAll, shopSchema } from '@/lib/hub/common';
import { resolveShopScope } from '@/lib/mcp/shops';
import { pct, previousRange } from '@/lib/mcp/metrics';
import { fetchEurRatesByDate, gaToPln } from '@/lib/ad-cost';

// Ruch na stronach z GA4 (fact_daily_traffic). Wiersze source='__total__' to
// sumy dzienne per usługa GA4 (zgodne z GA4), reszta — rozbicie na źródła.
// Hostname usługi GA4 = nazwa sklepu (mybed.pl, mybed.de, mittohome.pl, nomosleep.pl).

const TRAFFIC_DEFINITIONS = {
  sessions: 'Sesje GA4 (suma dzienna z raportu całości usługi).',
  users: 'Suma dziennych użytkowników — zawyża unikalnych użytkowników okresu.',
  conversion_rate: 'transactions / sessions × 100 (transakcje GA4, nie zamówienia ERP).',
  ga_revenue_pln: 'Przychód z e-commerce GA4 w PLN (mybed.de przeliczone z EUR po kursie z zamówień ERP z danego dnia).',
  google_ads_cost_pln: 'Koszt Google Ads raportowany w GA4 (tylko platforma Google Ads), PLN.',
  day: 'Data raportu GA4 (strefa czasowa usługi GA4).',
};

const SHOP_HOSTS = ['mybed.pl', 'mybed.de', 'mittohome.pl', 'nomosleep.pl'];

interface TotalRow {
  date: string; hostname: string; sessions: number | null; users: number | null; new_users: number | null;
  pageviews: number | null; transactions: number | null; ga_revenue: number | null;
  ad_cost: number | null; ad_clicks: number | null; ad_impressions: number | null;
}

async function fetchTotals(db: SupabaseClient, hosts: string[], from: string, to: string): Promise<TotalRow[]> {
  const out: TotalRow[] = [];
  if (!hosts.length) return out;
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const { data, error } = await db.from('fact_daily_traffic')
      .select('date, hostname, sessions, users, new_users, pageviews, transactions, ga_revenue, ad_cost, ad_clicks, ad_impressions')
      .eq('source', '__total__')
      .in('hostname', hosts)
      .gte('date', from).lte('date', to)
      .order('date', { ascending: true }).order('hostname', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(`fact_daily_traffic: ${error.message}`);
    const page = (data || []) as TotalRow[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

interface TAcc { sessions: number; users: number; newUsers: number; pageviews: number; transactions: number; revenue: number; adCost: number; adClicks: number; adImpr: number }
const emptyT = (): TAcc => ({ sessions: 0, users: 0, newUsers: 0, pageviews: 0, transactions: 0, revenue: 0, adCost: 0, adClicks: 0, adImpr: 0 });

function finalizeT(t: TAcc) {
  return {
    sessions: t.sessions,
    users: t.users,
    new_users: t.newUsers,
    pageviews: t.pageviews,
    transactions: t.transactions,
    conversion_rate: ratio(t.transactions, t.sessions, 100),
    ga_revenue_pln: round2(t.revenue),
    google_ads_cost_pln: round2(t.adCost),
    google_ads_clicks: t.adClicks,
    google_ads_impressions: t.adImpr,
  };
}

function hostsFor(shop: string | undefined, allowed: Parameters<typeof resolveShopScope>[1]) {
  const scope = resolveShopScope(shop, allowed);
  const hosts = scope.shops.filter(s => SHOP_HOSTS.includes(s));
  const warnings = scope.shops.filter(s => !SHOP_HOSTS.includes(s)).map(s => `${s}: brak usługi GA4 w hurtowni.`);
  return { shops: scope.shops, hosts, warnings };
}

export const trafficCapabilities: Capability[] = [
  defineCapability({
    name: 'traffic_summary',
    path: 'traffic/summary',
    tag: 'Ruch GA4',
    title: 'Ruch na stronach (GA4)',
    description: 'Sesje, użytkownicy, transakcje, współczynnik konwersji, przychód GA4 i koszt Google Ads per sklep / dzień / tydzień / miesiąc, ze zmianą względem poprzedniego okresu.',
    input: {
      shop: shopSchema,
      date_from: dateSchema,
      date_to: dateSchema,
      group_by: z.enum(GROUPINGS).default('total').describe('total | shop | day | week | month'),
    },
    run: async ({ db, auth }, a) => {
      checkRange(a.date_from, a.date_to);
      const { shops, hosts, warnings } = hostsFor(a.shop, auth.allowedShops);
      const prev = previousRange(a.date_from, a.date_to);
      const [rows, prevRows, rates] = await Promise.all([
        fetchTotals(db, hosts, a.date_from, a.date_to),
        fetchTotals(db, hosts, prev.from, prev.to),
        fetchEurRatesByDate(db, prev.from, a.date_to),
      ]);
      const addT = (t: TAcc, r: TotalRow) => {
        t.sessions += r.sessions || 0;
        t.users += r.users || 0;
        t.newUsers += r.new_users || 0;
        t.pageviews += r.pageviews || 0;
        t.transactions += r.transactions || 0;
        t.revenue += gaToPln(r.hostname, Number(r.ga_revenue) || 0, r.date, rates);
        t.adCost += gaToPln(r.hostname, Number(r.ad_cost) || 0, r.date, rates);
        t.adClicks += r.ad_clicks || 0;
        t.adImpr += r.ad_impressions || 0;
      };
      const total = emptyT();
      const prevTotal = emptyT();
      rows.forEach(r => addT(total, r));
      prevRows.forEach(r => addT(prevTotal, r));
      const t = finalizeT(total);
      const p = finalizeT(prevTotal);

      let groups: Array<Record<string, unknown>> = [];
      if (a.group_by !== 'total') {
        const map = new Map<string, TAcc>();
        for (const r of rows) {
          const key = a.group_by === 'shop' ? r.hostname : bucketKey(r.date, a.group_by);
          const acc = map.get(key) || emptyT();
          addT(acc, r);
          map.set(key, acc);
        }
        groups = [...map.entries()].sort(([x], [y]) => x.localeCompare(y))
          .map(([key, acc]) => ({ [a.group_by === 'shop' ? 'shop' : 'period']: key, ...finalizeT(acc) }));
      }
      const last = rows.length ? rows[rows.length - 1].date : null;
      return {
        rows: groups.length || 1,
        payload: {
          period: { from: a.date_from, to: a.date_to },
          previous_period: prev,
          shops,
          data_until: last,
          totals: {
            ...t,
            change: {
              sessions_pct: pct(t.sessions, p.sessions),
              transactions_pct: pct(t.transactions, p.transactions),
              conversion_rate_pct: pct(t.conversion_rate, p.conversion_rate),
              google_ads_cost_pct: pct(t.google_ads_cost_pln, p.google_ads_cost_pln),
            },
          },
          group_by: a.group_by,
          groups,
          warnings,
          definitions: TRAFFIC_DEFINITIONS,
        },
      };
    },
  }),

  defineCapability({
    name: 'traffic_sources',
    path: 'traffic/sources',
    tag: 'Ruch GA4',
    title: 'Źródła ruchu (GA4)',
    description: 'Źródło / medium z sesjami, transakcjami, konwersją i przychodem GA4 (PLN) za okres.',
    input: {
      shop: shopSchema,
      date_from: dateSchema,
      date_to: dateSchema,
      limit: z.number().int().min(1).max(200).default(25),
    },
    run: async ({ db, auth }, a) => {
      checkRange(a.date_from, a.date_to);
      const { shops, hosts, warnings } = hostsFor(a.shop, auth.allowedShops);
      if (!hosts.length) return { rows: 0, payload: { shops, rows: [], warnings } };
      const [rows, rates] = await Promise.all([
        rpcAll<{ hostname: string; source: string; medium: string; sessions: number; users: number; transactions: number; ga_revenue: number }>(
          db, 'hub_traffic_sources', { p_from: a.date_from, p_to: a.date_to, p_hosts: hosts }),
        fetchEurRatesByDate(db, a.date_from, a.date_to),
      ]);
      // Przychód hostów EUR po średnim kursie okresu (wiersze źródeł nie mają dnia).
      const map = new Map<string, { source: string; medium: string; sessions: number; users: number; transactions: number; revenue: number }>();
      for (const r of rows) {
        const key = `${r.source} / ${r.medium}`;
        const e = map.get(key) || { source: r.source, medium: r.medium, sessions: 0, users: 0, transactions: 0, revenue: 0 };
        e.sessions += Number(r.sessions) || 0;
        e.users += Number(r.users) || 0;
        e.transactions += Number(r.transactions) || 0;
        e.revenue += gaToPln(r.hostname, Number(r.ga_revenue) || 0, a.date_to, { byDate: {}, fallback: rates.fallback });
        map.set(key, e);
      }
      const totalSessions = [...map.values()].reduce((s, e) => s + e.sessions, 0);
      const out = [...map.values()].sort((x, y) => y.sessions - x.sessions).slice(0, a.limit).map(e => ({
        source: e.source,
        medium: e.medium,
        sessions: e.sessions,
        sessions_share_pct: ratio(e.sessions, totalSessions, 100, 1),
        users: e.users,
        transactions: e.transactions,
        conversion_rate: ratio(e.transactions, e.sessions, 100),
        ga_revenue_pln: round2(e.revenue),
      }));
      return {
        rows: out.length,
        payload: {
          period: { from: a.date_from, to: a.date_to },
          shops,
          rows: out,
          warnings: [...warnings, 'Przychód mybed.de (EUR) przeliczony po średnim kursie okresu.'],
          definitions: TRAFFIC_DEFINITIONS,
        },
      };
    },
  }),
];
