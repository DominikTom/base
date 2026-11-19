import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { defineCapability, forbidden, type Capability } from '@/lib/hub/core';
import { GROUPINGS, bucketKey, checkRange, dateSchema, ratio, round2 } from '@/lib/hub/common';
import { pct, previousRange } from '@/lib/mcp/metrics';

// Showroomy MyBed: sprzedaż z arkuszy Google showroomów (sensmax_showroom_sales,
// sync codziennie 04:30 UTC) i wejścia z liczników Sensmax (sensmax_daily_by_showroom).
// Showroomy należą do mybed.pl — dostęp wymaga tego sklepu w zakresie tokenu.

const SHOWROOMS = ['warszawa', 'marki', 'katowice', 'krakow', 'wroclaw', 'poznan', 'nowa'] as const;

const SHOWROOM_DEFINITIONS = {
  orders: 'Zamówienia z arkusza showroomu (data złożenia).',
  revenue_pln: 'Kwota z arkusza showroomu (PLN, tak jak wpisana przez showroom).',
  booked: 'Zamówienia oznaczone w arkuszu jako zaksięgowane (TAK).',
  visitors: 'Wejścia z liczników Sensmax (tylko showroomy z licznikami).',
  conversion_pct: 'Zamówienia / wejścia × 100, liczone tylko z dni, dla których są oba źródła.',
  avg_ticket_pln: 'revenue_pln / orders.',
};

interface SalesRow { showroom: string; date: string; orders: number; revenue_pln: number; booked_orders: number; booked_revenue_pln: number }
interface VisitRow { showroom: string; date: string; visits_total: number }

async function pageAll<T>(db: SupabaseClient, table: string, select: string, from: string, to: string, showroom?: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < 50_000; offset += 1000) {
    let q = db.from(table).select(select).gte('date', from).lte('date', to)
      .order('date', { ascending: true }).order('showroom', { ascending: true })
      .range(offset, offset + 999);
    if (showroom) q = q.eq('showroom', showroom);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data || []) as unknown as T[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

interface SAcc { orders: number; revenue: number; booked: number; bookedRevenue: number; visitors: number; ordersWithVisitors: number }
const emptyS = (): SAcc => ({ orders: 0, revenue: 0, booked: 0, bookedRevenue: 0, visitors: 0, ordersWithVisitors: 0 });

function finalizeS(a: SAcc) {
  return {
    orders: a.orders,
    revenue_pln: round2(a.revenue),
    avg_ticket_pln: ratio(a.revenue, a.orders),
    booked_orders: a.booked,
    booked_revenue_pln: round2(a.bookedRevenue),
    visitors: a.visitors,
    conversion_pct: ratio(a.ordersWithVisitors, a.visitors, 100, 1),
  };
}

function accumulate(sales: SalesRow[], visits: VisitRow[], keyFn: (showroom: string, date: string) => string) {
  const visitsByDay = new Map<string, number>();
  for (const v of visits) visitsByDay.set(`${v.showroom}|${v.date}`, Number(v.visits_total) || 0);
  const salesDays = new Set(sales.map(s => `${s.showroom}|${s.date}`));
  const map = new Map<string, SAcc>();
  const get = (k: string) => { const a = map.get(k) || emptyS(); map.set(k, a); return a; };
  for (const s of sales) {
    const a = get(keyFn(s.showroom, s.date));
    a.orders += Number(s.orders) || 0;
    a.revenue += Number(s.revenue_pln) || 0;
    a.booked += Number(s.booked_orders) || 0;
    a.bookedRevenue += Number(s.booked_revenue_pln) || 0;
    if (visitsByDay.has(`${s.showroom}|${s.date}`)) a.ordersWithVisitors += Number(s.orders) || 0;
  }
  for (const v of visits) {
    // Wejścia liczymy tylko z dni, dla których showroom ma też dane sprzedaży.
    if (!salesDays.has(`${v.showroom}|${v.date}`)) continue;
    get(keyFn(v.showroom, v.date)).visitors += Number(v.visits_total) || 0;
  }
  return map;
}

export const showroomCapabilities: Capability[] = [
  defineCapability({
    name: 'showrooms_summary',
    path: 'showrooms/summary',
    tag: 'Showroomy',
    title: 'Showroomy: sprzedaż i wejścia',
    description: 'Zamówienia i kwota sprzedaży showroomów (arkusze), zaksięgowane, wejścia z liczników Sensmax i konwersja — łącznie albo per showroom / dzień / tydzień / miesiąc, ze zmianą względem poprzedniego okresu.',
    input: {
      showroom: z.enum(SHOWROOMS).optional().describe('warszawa | marki | katowice | krakow | wroclaw | poznan | nowa. Brak = wszystkie.'),
      date_from: dateSchema,
      date_to: dateSchema,
      group_by: z.enum(GROUPINGS).default('total').describe('total | shop (showroom) | day | week | month'),
    },
    run: async ({ db, auth }, a) => {
      checkRange(a.date_from, a.date_to);
      if (!auth.allowedShops.includes('mybed.pl')) throw forbidden('Showroomy wymagają dostępu do sklepu mybed.pl.');
      const prev = previousRange(a.date_from, a.date_to);
      const [sales, visits, prevSales, prevVisits] = await Promise.all([
        pageAll<SalesRow>(db, 'sensmax_showroom_sales', 'showroom, date, orders, revenue_pln, booked_orders, booked_revenue_pln', a.date_from, a.date_to, a.showroom),
        pageAll<VisitRow>(db, 'sensmax_daily_by_showroom', 'showroom, date, visits_total', a.date_from, a.date_to, a.showroom),
        pageAll<SalesRow>(db, 'sensmax_showroom_sales', 'showroom, date, orders, revenue_pln, booked_orders, booked_revenue_pln', prev.from, prev.to, a.showroom),
        pageAll<VisitRow>(db, 'sensmax_daily_by_showroom', 'showroom, date, visits_total', prev.from, prev.to, a.showroom),
      ]);
      const t = finalizeS(accumulate(sales, visits, () => 'total').get('total') || emptyS());
      const p = finalizeS(accumulate(prevSales, prevVisits, () => 'total').get('total') || emptyS());

      let groups: Array<Record<string, unknown>> = [];
      if (a.group_by !== 'total') {
        const grain = a.group_by;
        const map = accumulate(sales, visits, (showroom, date) => (grain === 'shop' ? showroom : bucketKey(date, grain)));
        groups = [...map.entries()].sort(([x], [y]) => x.localeCompare(y))
          .map(([key, acc]) => ({ [grain === 'shop' ? 'showroom' : 'period']: key, ...finalizeS(acc) }));
        if (grain === 'shop') groups.sort((x, y) => Number(y.revenue_pln) - Number(x.revenue_pln));
      }
      const withoutSensors = [...new Set(sales.map(s => s.showroom))].filter(s => !visits.some(v => v.showroom === s));
      const lastSales = sales.length ? sales[sales.length - 1].date : null;
      return {
        rows: groups.length || 1,
        payload: {
          period: { from: a.date_from, to: a.date_to },
          previous_period: prev,
          data_until: lastSales,
          totals: {
            ...t,
            change: {
              orders_pct: pct(t.orders, p.orders),
              revenue_pct: pct(t.revenue_pln, p.revenue_pln),
              visitors_pct: pct(t.visitors, p.visitors),
              conversion_pct_change: pct(t.conversion_pct, p.conversion_pct),
            },
          },
          group_by: a.group_by,
          groups,
          warnings: withoutSensors.length ? [`Bez liczników wejść (konwersja niedostępna): ${withoutSensors.join(', ')}.`] : [],
          definitions: SHOWROOM_DEFINITIONS,
        },
      };
    },
  }),
];
