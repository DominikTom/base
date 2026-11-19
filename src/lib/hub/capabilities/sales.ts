import { z } from 'zod';
import { defineCapability, type Capability } from '@/lib/hub/core';
import {
  GROUPINGS, bucketKey, channelForSource, channelSchema, checkRange, dateSchema, ratio,
  resolveSalesScope, round2, rpcAll,
} from '@/lib/hub/common';
import { pct, previousRange } from '@/lib/mcp/metrics';

// Sprzedaż i produkty z hurtowni dash (fact_orders / fact_order_items,
// zasilane eksportem IdeaERP). Definicje w SALES_DEFINITIONS — poprawione
// względem dzisiejszych widgetów dashboardu (patrz audyt 2026-11).

export const SALES_DEFINITIONS = {
  sales: 'Zamówienia w statusach „Zamówienie sprzedaży” i „Zrealizowane”. Oferty i anulowane są raportowane osobno i nie wchodzą do przychodu.',
  revenue_pln: 'Brutto w PLN (pole „Suma” z ERP, z kosztem dostawy). EUR/CZK przeliczone po kursie NBP z dnia zamówienia.',
  revenue_excl_shipping_pln: 'revenue_pln minus koszt dostawy.',
  day: 'Dzień zamówienia w strefie Europe/Warsaw.',
  aov_pln: 'revenue_pln / orders.',
  payment_rate: 'Opłacone zamówienia / zamówienia × 100 (flaga „Zapłacone” w ERP).',
  zam: 'Zamówienia ZAM/ (showroomy, magazyn) domyślnie pominięte — include_internal=true je dołącza. Sprzedaż showroomów: showrooms_summary.',
  source: 'Eksport IdeaERP, odświeżany raz dziennie (rano); dzisiejsze zamówienia mogą jeszcze nie być widoczne.',
};

interface SalesRow {
  day: string;
  source_shop: string;
  currency: string;
  orders_total: number;
  orders_billable: number;
  orders_paid: number;
  orders_offer: number;
  orders_cancelled: number;
  orders_other: number;
  revenue_billable_pln: number;
  revenue_billable_orig: number;
  revenue_paid_pln: number;
  shipping_billable_pln: number;
  revenue_offer_pln: number;
  revenue_cancelled_pln: number;
}

interface Acc {
  orders: number; revenue: number; paidOrders: number; paidRevenue: number; shipping: number;
  offers: number; offersValue: number; cancelled: number; cancelledValue: number; other: number;
  byCurrency: Record<string, number>;
}

const emptyAcc = (): Acc => ({
  orders: 0, revenue: 0, paidOrders: 0, paidRevenue: 0, shipping: 0,
  offers: 0, offersValue: 0, cancelled: 0, cancelledValue: 0, other: 0, byCurrency: {},
});

function add(acc: Acc, r: SalesRow) {
  const num = (v: unknown) => Number(v) || 0;
  acc.orders += num(r.orders_billable);
  acc.revenue += num(r.revenue_billable_pln);
  acc.paidOrders += num(r.orders_paid);
  acc.paidRevenue += num(r.revenue_paid_pln);
  acc.shipping += num(r.shipping_billable_pln);
  acc.offers += num(r.orders_offer);
  acc.offersValue += num(r.revenue_offer_pln);
  acc.cancelled += num(r.orders_cancelled);
  acc.cancelledValue += num(r.revenue_cancelled_pln);
  acc.other += num(r.orders_other);
  if (num(r.orders_billable) > 0) {
    acc.byCurrency[r.currency] = (acc.byCurrency[r.currency] || 0) + num(r.revenue_billable_orig);
  }
}

function finalizeAcc(a: Acc) {
  return {
    orders: a.orders,
    revenue_pln: round2(a.revenue),
    revenue_excl_shipping_pln: round2(a.revenue - a.shipping),
    aov_pln: ratio(a.revenue, a.orders),
    paid_orders: a.paidOrders,
    paid_revenue_pln: round2(a.paidRevenue),
    unpaid_revenue_pln: round2(a.revenue - a.paidRevenue),
    payment_rate: ratio(a.paidOrders, a.orders, 100, 1),
    shipping_pln: round2(a.shipping),
    revenue_by_currency: Object.fromEntries(Object.entries(a.byCurrency).map(([c, v]) => [c, round2(v)])),
    offers: { orders: a.offers, value_pln: round2(a.offersValue) },
    cancelled: { orders: a.cancelled, value_pln: round2(a.cancelledValue) },
    other_status_orders: a.other,
  };
}

const PRODUCT_DIMENSIONS = ['product', 'category', 'fabric_collection', 'fabric', 'bed_size', 'mattress_type', 'headboard_height', 'storage_type'] as const;

export const salesCapabilities: Capability[] = [
  defineCapability({
    name: 'sales_summary',
    path: 'sales/summary',
    tag: 'Sprzedaż',
    title: 'Sprzedaż',
    description: 'Zamówienia, przychód brutto PLN, AOV, płatności, oferty i anulowane za okres — łącznie albo per kanał / dzień / tydzień / miesiąc — ze zmianą względem poprzedniego okresu tej samej długości.',
    input: {
      channel: channelSchema,
      date_from: dateSchema,
      date_to: dateSchema,
      group_by: z.enum(GROUPINGS).default('total').describe('total | shop (kanał) | day | week | month'),
      include_internal: z.boolean().default(false).describe('Dołącz zamówienia ZAM/ (showroomy, magazyn).'),
    },
    run: async ({ db, auth }, a) => {
      checkRange(a.date_from, a.date_to);
      const scope = resolveSalesScope(a.channel, auth.allowedShops, a.include_internal);
      const prev = previousRange(a.date_from, a.date_to);
      const [rows, prevRows] = await Promise.all([
        rpcAll<SalesRow>(db, 'hub_sales_daily', { p_from: a.date_from, p_to: a.date_to, p_shops: scope.sourceShops }),
        rpcAll<SalesRow>(db, 'hub_sales_daily', { p_from: prev.from, p_to: prev.to, p_shops: scope.sourceShops }),
      ]);

      const total = emptyAcc();
      const prevTotal = emptyAcc();
      for (const r of rows) add(total, r);
      for (const r of prevRows) add(prevTotal, r);
      const t = finalizeAcc(total);
      const p = finalizeAcc(prevTotal);

      let groups: Array<Record<string, unknown>> = [];
      if (a.group_by !== 'total') {
        const map = new Map<string, Acc>();
        for (const r of rows) {
          const key = a.group_by === 'shop' ? channelForSource(r.source_shop) : bucketKey(String(r.day), a.group_by);
          const acc = map.get(key) || emptyAcc();
          add(acc, r);
          map.set(key, acc);
        }
        groups = [...map.entries()]
          .sort(([x], [y]) => (a.group_by === 'shop' ? 0 : x.localeCompare(y)))
          .map(([key, acc]) => ({ [a.group_by === 'shop' ? 'channel' : 'period']: key, ...finalizeAcc(acc) }));
        if (a.group_by === 'shop') groups.sort((x, y) => Number(y.revenue_pln) - Number(x.revenue_pln));
      }

      const warnings: string[] = [];
      if (scope.channels.includes('mojepostel.cz') && !rows.some(r => r.source_shop === 'mojepostel.cz')) {
        warnings.push('mojepostel.cz: brak zamówień w tym okresie albo jeszcze nie przeliczone po zmianie parsera (CZK) — pojawią się po najbliższym imporcie ERP.');
      }

      return {
        rows: groups.length || 1,
        payload: {
          period: { from: a.date_from, to: a.date_to },
          previous_period: prev,
          channels: scope.channels,
          totals: {
            ...t,
            change: {
              orders_pct: pct(t.orders, p.orders),
              revenue_pct: pct(t.revenue_pln, p.revenue_pln),
              aov_pct: pct(t.aov_pln, p.aov_pln),
              previous: { orders: p.orders, revenue_pln: p.revenue_pln, aov_pln: p.aov_pln },
            },
          },
          group_by: a.group_by,
          groups,
          warnings,
          definitions: SALES_DEFINITIONS,
        },
      };
    },
  }),

  defineCapability({
    name: 'products_ranking',
    path: 'products/ranking',
    tag: 'Sprzedaż',
    title: 'Ranking produktów i atrybutów',
    description: 'Najczęściej sprzedawane modele, kategorie, tkaniny, kolekcje tkanin, rozmiary, materace, wysokości wezgłowia i stelaże — w sprzedanych zamówieniach (bez ofert i anulowanych). Domyślnie bez próbek.',
    input: {
      channel: channelSchema,
      date_from: dateSchema,
      date_to: dateSchema,
      dimension: z.enum(PRODUCT_DIMENSIONS).default('product'),
      include_samples: z.boolean().default(false).describe('Dołącz próbki tkanin (np. do rankingu tkanin zamawianych jako próbki).'),
      include_internal: z.boolean().default(false).describe('Dołącz zamówienia ZAM/.'),
      limit: z.number().int().min(1).max(200).default(20),
    },
    run: async ({ db, auth }, a) => {
      checkRange(a.date_from, a.date_to);
      const scope = resolveSalesScope(a.channel, auth.allowedShops, a.include_internal);
      const rows = await rpcAll<{ value: string; quantity: number; orders: number; orders_in_scope: number }>(
        db, 'hub_product_ranking', {
          p_from: a.date_from, p_to: a.date_to, p_shops: scope.sourceShops,
          p_dimension: a.dimension, p_include_samples: a.include_samples, p_limit: a.limit,
        },
      );
      const inScope = rows[0] ? Number(rows[0].orders_in_scope) : 0;
      return {
        rows: rows.length,
        payload: {
          period: { from: a.date_from, to: a.date_to },
          channels: scope.channels,
          dimension: a.dimension,
          orders_in_scope: inScope,
          rows: rows.map(r => ({
            value: r.value,
            quantity: Number(r.quantity),
            orders: Number(r.orders),
            orders_share_pct: ratio(Number(r.orders), inScope, 100, 1),
          })),
          warnings: [] as string[],
          definitions: {
            quantity: 'Suma sztuk w pozycjach zamówień (bez wysyłki, usług i dopłat).',
            orders: 'Liczba zamówień z daną wartością.',
            orders_share_pct: 'orders / wszystkie sprzedane zamówienia w zakresie × 100.',
            sample: 'Próbka = kategoria „próbki” albo pozycja „<kolekcja tkaniny> <numer>”.',
            ...SALES_DEFINITIONS,
          },
        },
      };
    },
  }),
];
