import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { badRequest, forbidden } from './core';
import { MCP_SHOPS, type McpShop } from '@/lib/mcp/shops';
import { DATE_RE, daysBetweenInclusive } from '@/lib/mcp/metrics';

export const MAX_RANGE_DAYS = 400;
export const dateSchema = z.string().regex(DATE_RE, 'Format YYYY-MM-DD');
export const shopSchema = z.enum(MCP_SHOPS).optional()
  .describe('Sklep: mybed.pl | mybed.de | mojepostel.cz | mittohome.pl | nomosleep.pl. Brak = wszystkie dostępne.');
export const GROUPINGS = ['total', 'shop', 'day', 'week', 'month'] as const;
export type Grouping = (typeof GROUPINGS)[number];

export function checkRange(from: string, to: string) {
  if (from > to) throw badRequest('date_from nie może być późniejsze niż date_to.');
  if (daysBetweenInclusive(from, to) > MAX_RANGE_DAYS) throw badRequest(`Maksymalny zakres to ${MAX_RANGE_DAYS} dni.`);
}

/** Klucz kubełka czasu: dzień, poniedziałek tygodnia (ISO) albo miesiąc YYYY-MM. */
export function bucketKey(day: string, grain: 'day' | 'week' | 'month'): string {
  if (grain === 'month') return day.slice(0, 7);
  if (grain === 'week') {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return day;
}

// ── Kanały sprzedaży ────────────────────────────────────────
// Kanał = wartość source_shop w fact_orders. Każdy kanał ma „właściciela” —
// sklep, którego zakres w tokenie uprawnia do jego danych.
export const SALES_CHANNELS = {
  'mybed.pl': { owner: 'mybed.pl', sourceShops: ['mybed.pl'], internal: false },
  'mybed.de': { owner: 'mybed.de', sourceShops: ['mybed.de'], internal: false },
  'mojepostel.cz': { owner: 'mojepostel.cz', sourceShops: ['mojepostel.cz'], internal: false },
  'mittohome.pl': { owner: 'mittohome.pl', sourceShops: ['mittohome.pl'], internal: false },
  'nomosleep.pl': { owner: 'nomosleep.pl', sourceShops: ['nomosleep.pl'], internal: false },
  'allegro.pl': { owner: 'mybed.pl', sourceShops: ['allegro.pl'], internal: false },
  'amazon.de': { owner: 'mybed.de', sourceShops: ['amazon.de'], internal: false },
  'kaufland.de': { owner: 'mybed.de', sourceShops: ['kaufland.de'], internal: false },
  // Zamówienia ZAM/ z ERP (showroomy, magazyn) — w CFO Studio traktowane jako
  // wewnętrzne; sprzedaż showroomów jest w showrooms_summary (arkusze Sensmax).
  'zam': { owner: 'mybed.pl', sourceShops: ['manual'], internal: true },
} as const satisfies Record<string, { owner: McpShop; sourceShops: readonly string[]; internal: boolean }>;

export type SalesChannel = keyof typeof SALES_CHANNELS;
export const SALES_CHANNEL_KEYS = Object.keys(SALES_CHANNELS) as SalesChannel[];

export const channelSchema = z.enum(SALES_CHANNEL_KEYS as [SalesChannel, ...SalesChannel[]]).optional()
  .describe('Kanał: sklepy (mybed.pl, mybed.de, mojepostel.cz, mittohome.pl, nomosleep.pl), marketplace’y (allegro.pl, amazon.de, kaufland.de) albo zam (zamówienia ZAM/). Brak = wszystkie dostępne kanały.');

const SOURCE_TO_CHANNEL: Record<string, SalesChannel> = Object.fromEntries(
  SALES_CHANNEL_KEYS.flatMap(ch => SALES_CHANNELS[ch].sourceShops.map(s => [s, ch])),
) as Record<string, SalesChannel>;

export function channelForSource(sourceShop: string): string {
  return SOURCE_TO_CHANNEL[sourceShop] ?? sourceShop;
}

export interface SalesScope {
  channels: SalesChannel[];
  sourceShops: string[];
}

export function resolveSalesScope(requested: string | undefined, allowed: readonly McpShop[], includeInternal: boolean): SalesScope {
  if (allowed.length === 0) throw forbidden('Twoje konto nie ma przypisanych sklepów — poproś admina o dostęp.');
  let channels: SalesChannel[];
  if (requested) {
    const ch = requested as SalesChannel;
    if (!SALES_CHANNELS[ch]) throw badRequest(`Nieznany kanał „${requested}”. Dozwolone: ${SALES_CHANNEL_KEYS.join(', ')}.`);
    if (!allowed.includes(SALES_CHANNELS[ch].owner)) {
      throw forbidden(`Brak dostępu do kanału ${requested} (wymaga dostępu do ${SALES_CHANNELS[ch].owner}).`);
    }
    channels = [ch];
  } else {
    channels = SALES_CHANNEL_KEYS.filter(ch => allowed.includes(SALES_CHANNELS[ch].owner) && (includeInternal || !SALES_CHANNELS[ch].internal));
  }
  return { channels, sourceShops: channels.flatMap(ch => [...SALES_CHANNELS[ch].sourceShops]) };
}

/** Wywołanie funkcji SQL ze stronicowaniem (limit 1000 wierszy PostgREST dotyczy też RPC). */
export async function rpcAll<T>(db: SupabaseClient, fn: string, params: Record<string, unknown>, maxRows = 100_000): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < maxRows; offset += PAGE) {
    const { data, error } = await db.rpc(fn, params).range(offset, offset + PAGE - 1);
    if (error) {
      if (/function .* does not exist|Could not find the function/i.test(error.message)) {
        throw new Error(`Brak funkcji ${fn} w bazie — zastosuj migrację supabase/migrations/026_data_hub_functions.sql.`);
      }
      throw new Error(`${fn}: ${error.message}`);
    }
    const page = (data || []) as T[];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
  throw badRequest('Za dużo wierszy — zawęź zakres dat.');
}

export const round2 = (v: number) => Math.round(v * 100) / 100;
export const ratio = (num: number, den: number, mult = 1, digits = 2): number | null =>
  den > 0 ? Math.round((num / den) * mult * 10 ** digits) / 10 ** digits : null;
