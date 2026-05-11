import { google } from 'googleapis';
import { getSupabaseAdmin } from '@/lib/supabase';
import type { Showroom } from './types';

// Per-showroom Google Sheets (shared read-only with the service account in
// GOOGLE_SERVICE_ACCOUNT_JSON). Monthly tabs named like "04/2026".
export const SALES_SHEETS: Partial<Record<Showroom, string>> = {
  warszawa: '1pJNirp3QHuCoTPQgWcFR6cfEBTYQZ5lyFMUKH45p-eg',
  marki: '141hgRqdfHB1LBl7Ip0UFnhzGBExkb0t3u-saa5Ldfro',
  katowice: '1pX1GmHy0Fp6qWV5KEmry3aN7OU4kPOMCrjiz1pAZfc4',
  krakow: '11KQMXMCTHKF5Et4_VHf_KnRIUgQfF-LfSEwgJdXeafE',
  wroclaw: '1gAH1bbzc7rnZUVkIMOlZAo89W7BLVqTDP37yuixW2dA',
  poznan: '1DyTIr7u5c4ooCDTj4v6H3LmjNwGCO1aMVtmeyecSLhc',
};

export const SALES_SHOWROOMS = Object.keys(SALES_SHEETS) as Showroom[];

function getSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set');
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

const SKIP_TAB_RE = /^(grafik|dane|template|szablon|instrukcj|info|notatk|archiw)/i;

function parseAmount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  // "4 114,52" / "3 992" / "4032,5" / "3992 zł"
  const cleaned = value
    .replace(/ /g, ' ')
    .replace(/\s+/g, '')
    .replace(/zł/i, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '') // thousands dot
    .replace(',', '.');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(value: unknown): string | null {
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
    if (m) {
      const dd = Number(m[1]);
      const mm = Number(m[2]);
      if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) return `${m[3]}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      return null;
    }
    const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    return null;
  }
  if (typeof value === 'number' && value > 30000 && value < 60000) {
    // Sheets serial date (days since 1899-12-30)
    const ms = Math.round((value - 25569) * 86_400_000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

interface DayAgg {
  orders: number;
  revenue: number;
  bookedOrders: number;
  bookedRevenue: number;
}

async function readSheetSales(sheetId: string): Promise<Map<string, DayAgg>> {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties(title)' });
  const tabs = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title ?? '')
    .filter((t) => t && !SKIP_TAB_RE.test(t.trim()));
  if (tabs.length === 0) return new Map();

  const batch = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges: tabs.map((t) => `'${t.replace(/'/g, "''")}'!A:J`),
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  const byDate = new Map<string, DayAgg>();
  const seenOrders = new Set<string>();

  for (const vr of batch.data.valueRanges ?? []) {
    const rows = vr.values ?? [];
    if (rows.length === 0) continue;

    // locate the header row + relevant columns
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      const joined = (rows[i] ?? []).map((c) => String(c ?? '').toLowerCase()).join('|');
      if (joined.includes('data złoż') || joined.includes('data zloz') || (joined.includes('nr zam') && joined.includes('kwota'))) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) continue;

    const header = (rows[headerIdx] ?? []).map((c) => String(c ?? '').toLowerCase().trim());
    const findCol = (...needles: string[]) => header.findIndex((h) => needles.some((n) => h.includes(n)));
    const cOrder = (() => { const i = findCol('nr zam'); return i >= 0 ? i : 0; })();
    const cAmount = (() => { const i = findCol('kwota'); return i >= 0 ? i : 1; })();
    const cDate = (() => { const i = findCol('data złoż', 'data zloz', 'data złoz'); return i >= 0 ? i : 3; })();
    const cBooked = (() => { const i = findCol('zaksięg', 'zaksieg'); return i >= 0 ? i : 5; })();

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const date = parseDate(row[cDate]);
      if (!date) continue; // separator / totals / pending-without-date rows
      const orderId = String(row[cOrder] ?? '').trim();
      if (orderId) {
        const key = `${sheetId}|${orderId}`;
        if (seenOrders.has(key)) continue; // same order entered twice
        seenOrders.add(key);
      }
      const amount = parseAmount(row[cAmount]);
      const booked = String(row[cBooked] ?? '').trim().toUpperCase() === 'TAK';
      const agg = byDate.get(date) ?? { orders: 0, revenue: 0, bookedOrders: 0, bookedRevenue: 0 };
      agg.orders += 1;
      agg.revenue += amount;
      if (booked) {
        agg.bookedOrders += 1;
        agg.bookedRevenue += amount;
      }
      byDate.set(date, agg);
    }
  }

  return byDate;
}

export async function syncShowroomSales() {
  const db = getSupabaseAdmin();
  const result: Record<string, { days: number; orders: number; revenue: number; error?: string }> = {};

  for (const showroom of SALES_SHOWROOMS) {
    const sheetId = SALES_SHEETS[showroom]!;
    try {
      const byDate = await readSheetSales(sheetId);
      const rows = [...byDate.entries()].map(([date, a]) => ({
        showroom,
        date,
        orders: a.orders,
        revenue_pln: Math.round(a.revenue * 100) / 100,
        booked_orders: a.bookedOrders,
        booked_revenue_pln: Math.round(a.bookedRevenue * 100) / 100,
        source_sheet_id: sheetId,
        fetched_at: new Date().toISOString(),
      }));
      if (rows.length > 0) {
        const { error } = await db.from('sensmax_showroom_sales').upsert(rows, { onConflict: 'showroom,date' });
        if (error) throw error;
      }
      result[showroom] = {
        days: rows.length,
        orders: rows.reduce((s, r) => s + r.orders, 0),
        revenue: Math.round(rows.reduce((s, r) => s + r.revenue_pln, 0) * 100) / 100,
      };
    } catch (e) {
      result[showroom] = { days: 0, orders: 0, revenue: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return result;
}
