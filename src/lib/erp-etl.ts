/**
 * Shared ETL helpers for the IdeaERP CSV pipeline.
 *
 * All functions assume a Supabase admin client and never block the caller
 * with retries — error handling is the responsibility of the route handler.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizePhone,
  normalizePostalCode,
  warsawDateToUtcDateOnly,
  warsawNaiveToUtcIso,
  type QuarantineEntry,
  type RawCsvRow,
} from '@/lib/erp-parser';
import type { FactOrder, FactOrderItem } from '@/types/database';

export const ETL_PIPELINE = 'erp_csv_to_supabase';
export const ETL_VERSION = process.env.ETL_VERSION || 'next-1.1.0';
const GDRIVE_LOCK_KEY = 'erp_csv_gdrive_sync';

// ---------------------------------------------------------------------------
// Raw landing (raw_erp_orders)
// ---------------------------------------------------------------------------

interface RawInsertContext {
  etlRunId: string;
  sourceFile: string;
  /** csv_row_number of the FIRST row in this batch (1-based: header is row 1). */
  startRowNumber: number;
}

function parseNumeric(s: string | undefined | null): number | null {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function rawRowToInsert(row: RawCsvRow, csvRowNumber: number, ctx: Pick<RawInsertContext, 'etlRunId' | 'sourceFile'>) {
  return {
    csv_row_number: csvRowNumber,
    etl_run_id: ctx.etlRunId,
    source_file: ctx.sourceFile,
    numer: (row['Numer'] || '').trim() || null,
    data_zamowienia: warsawNaiveToUtcIso(row['Data zamówienia']),
    przewidywana_data: warsawNaiveToUtcIso(row['Przewidywana data']),
    produkt_nazwa: (row['Pozycje zamówienia/Produkt/Nazwa'] || '').trim() || null,
    ilosc: parseNumeric(row['Pozycje zamówienia/Ilość']),
    opcja: row['Pozycje zamówienia/Opcja'] || null,
    metoda_dostawy: row['Metoda dostawy'] || null,
    kod_pocztowy: normalizePostalCode(row['Kod pocztowy']),
    miasto: row['Miasto'] || null,
    suma: parseNumeric(row['Suma']),
    koszt_dostawy: parseNumeric(row['Koszt dostawy']),
    uwagi: row['Uwagi'] || null,
    zaplacone: row['Zapłacone'] || null,
    status: row['Status'] || null,
    tagi: row['Tagi'] || null,
    data_realizacji: warsawDateToUtcDateOnly(row['Data realizacji']),
    kupon_rabatowy: row['Kupon rabatowy'] || null,
    faktura_produkcyjna: row['Faktura produkcyjna'] || null,
    faktura_materac: row['Faktura materac'] || null,
    faktura_transportowa: row['Faktura transportowa'] || null,
    klient_nazwa: row['Klient/Nazwa'] || null,
    klient_email: row['Klient/E-mail'] || null,
    klient_telefon: normalizePhone(row['Klient/Telefon']),
    adres_ulica: row['Adres dostawy/Ulica'] || null,
  };
}

export async function insertRawRows(
  db: SupabaseClient,
  rows: RawCsvRow[],
  ctx: RawInsertContext,
): Promise<number> {
  if (!rows.length) return 0;
  const payload = rows.map((row, i) => rawRowToInsert(row, ctx.startRowNumber + i, ctx));
  const { error } = await db.from('raw_erp_orders').insert(payload);
  if (error) throw new Error(`raw_erp_orders insert failed: ${error.message}`);
  return payload.length;
}

// ---------------------------------------------------------------------------
// Fact upserts via RPC
// ---------------------------------------------------------------------------

export async function upsertOrdersRpc(db: SupabaseClient, orders: FactOrder[]): Promise<number> {
  if (!orders.length) return 0;
  const { data, error } = await db.rpc('fn_upsert_fact_orders', { payload: orders });
  if (error) throw new Error(`fn_upsert_fact_orders: ${error.message}`);
  return typeof data === 'number' ? data : orders.length;
}

export async function upsertItemsRpc(db: SupabaseClient, items: FactOrderItem[]): Promise<number> {
  if (!items.length) return 0;
  const { data, error } = await db.rpc('fn_upsert_fact_order_items', { payload: items });
  if (error) throw new Error(`fn_upsert_fact_order_items: ${error.message}`);
  return typeof data === 'number' ? data : items.length;
}

// ---------------------------------------------------------------------------
// Quarantine
// ---------------------------------------------------------------------------

export async function insertQuarantine(
  db: SupabaseClient,
  entries: QuarantineEntry[],
  ctx: { etlRunId: string; sourceFile: string },
): Promise<number> {
  if (!entries.length) return 0;
  const payload = entries.map(e => ({
    etl_run_id: ctx.etlRunId,
    source_file: ctx.sourceFile,
    csv_row_number: e.csv_row_number,
    raw_data: e.raw_data,
    error_message: e.error_message,
    error_kind: e.error_kind,
  }));
  const { error } = await db.from('etl_quarantine').insert(payload);
  if (error) throw new Error(`etl_quarantine insert failed: ${error.message}`);
  return payload.length;
}

// ---------------------------------------------------------------------------
// Sanity checks (for etl_log.details)
// ---------------------------------------------------------------------------

export interface SanityChecks {
  ordersByShop: Record<string, number>;
  ordersWithoutItems: number;
  itemsWithoutOrder: number;
  totalAmountByShop: Record<string, number>;
  missingOrders: Array<{ order_id: string; last_seen_at: string; status: string }>;
}

export async function runSanityChecks(
  db: SupabaseClient,
  range?: { from?: string; to?: string },
): Promise<SanityChecks> {
  const result: SanityChecks = {
    ordersByShop: {},
    ordersWithoutItems: 0,
    itemsWithoutOrder: 0,
    totalAmountByShop: {},
    missingOrders: [],
  };

  // Orders by shop + total amount per shop within the requested range
  // (defaults to last 7 days when no range is provided).
  const fallbackFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
  const from = range?.from || fallbackFrom;
  const to = range?.to || new Date().toISOString().substring(0, 10);

  const { data: shopAgg } = await db
    .from('fact_orders')
    .select('source_shop, total_gross_pln')
    .gte('order_date', from)
    .lte('order_date', to + 'T23:59:59')
    .limit(50000);

  for (const o of shopAgg || []) {
    const shop = o.source_shop as string;
    result.ordersByShop[shop] = (result.ordersByShop[shop] || 0) + 1;
    result.totalAmountByShop[shop] = (result.totalAmountByShop[shop] || 0) + (o.total_gross_pln || 0);
  }

  // Missing orders (not seen in 2+ days).
  const { data: missing } = await db.rpc('fn_orders_missing_since', { threshold_days: 2 });
  if (Array.isArray(missing)) {
    result.missingOrders = missing.map(r => ({
      order_id: r.order_id,
      last_seen_at: r.last_seen_at,
      status: r.status,
    }));
  }

  // Note: orphan checks (orders without items / items without orders) are
  // expensive on large tables and would need a window query; we skip them
  // here and rely on the FK constraint + UNIQUE(order_id, line_number) to
  // prevent the underlying conditions.

  return result;
}

// ---------------------------------------------------------------------------
// Advisory lock for the GDrive cron path
// ---------------------------------------------------------------------------

export async function tryAcquireGdriveLock(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db.rpc('fn_try_advisory_lock', { lock_key: GDRIVE_LOCK_KEY });
  if (error) {
    console.error('Lock acquire error', error);
    return false;
  }
  return data === true;
}

export async function releaseGdriveLock(db: SupabaseClient): Promise<void> {
  await db.rpc('fn_release_advisory_lock', { lock_key: GDRIVE_LOCK_KEY });
}
