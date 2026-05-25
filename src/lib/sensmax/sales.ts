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

function parseTabMonth(title: string): { year: number; month: number } | null {
  const m = title.trim().match(/^(\d{1,2})\s*[/.\-]\s*(\d{4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const year = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function parseAmount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  // "4 114,52" / "3 992" / "4032,5" / "3992 zł" / "12.509,10"
  const cleaned = value
    .replace(/[\s ]/g, '')
    .replace(/zł/gi, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '') // thousands dot
    .replace(',', '.');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

const isoDay = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const validDM = (d: number, m: number) => d >= 1 && d <= 31 && m >= 1 && m <= 12;

function parseDate(value: unknown, tabHint?: { year: number; month: number } | null): string | null {
  if (typeof value === 'number') {
    if (value > 30000 && value < 60000) {
      // Sheets serial date (days since 1899-12-30)
      return new Date(Math.round((value - 25569) * 86_400_000)).toISOString().slice(0, 10);
    }
    return null;
  }
  if (typeof value !== 'string') return null;

  // normalise: drop whitespace, treat , ; - as the . separator, collapse repeats
  const s = value.trim().replace(/[\s ]/g, '').replace(/[,;\-]/g, '.').replace(/\.{2,}/g, '.').replace(/^\.|\.$/g, '');

  // YYYY-MM-DD (already separated above into YYYY.MM.DD)
  let m = s.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (m) {
    const y = +m[1];
    const mo = +m[2];
    const d = +m[3];
    return validDM(d, mo) ? isoDay(y, mo, d) : null;
  }
  // DD.MM.YYYY or DD.MM.YY
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) {
    const d = +m[1];
    let mo = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    if (!validDM(d, mo)) return null;
    if (tabHint) {
      // a date in the "MM/YYYY" tab whose year is off but month matches → almost certainly a year typo
      if (mo === tabHint.month && y !== tabHint.year) y = tabHint.year;
      // ...or whose month is the tab month written wrong (rare) — leave the month, only fix year above
    }
    return isoDay(y, mo, d);
  }
  // DD.MM (no year) → use the tab's year
  m = s.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (m && tabHint) {
    const d = +m[1];
    const mo = +m[2];
    if (!validDM(d, mo)) return null;
    return isoDay(tabHint.year, mo, d);
  }
  return null;
}

interface DayAgg {
  orders: number;
  revenue: number;
  bookedOrders: number;
  bookedRevenue: number;
}

interface SheetResult {
  byDate: Map<string, DayAgg>;
  rowsParsed: number;
  rowsSkippedNoDate: number;
  rowsDeduped: number;
}

async function readSheetSales(sheetId: string): Promise<SheetResult> {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'sheets.properties(title)' });
  const tabTitles = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title ?? '')
    .filter((t) => t && !SKIP_TAB_RE.test(t.trim()));

  const result: SheetResult = { byDate: new Map(), rowsParsed: 0, rowsSkippedNoDate: 0, rowsDeduped: 0 };
  if (tabTitles.length === 0) return result;

  const batch = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges: tabTitles.map((t) => `'${t.replace(/'/g, "''")}'!A:J`),
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  const seen = new Set<string>();
  const valueRanges = batch.data.valueRanges ?? [];

  for (let t = 0; t < valueRanges.length; t += 1) {
    const rows = valueRanges[t].values ?? [];
    if (rows.length === 0) continue;
    const tabHint = parseTabMonth(tabTitles[t] ?? '');

    // locate the header row + relevant columns
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      const joined = (rows[i] ?? []).map((c) => String(c ?? '').toLowerCase()).join('|');
      if (joined.includes('data zł') || joined.includes('data zl') || (joined.includes('nr zam') && joined.includes('kwota'))) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) continue;

    const header = (rows[headerIdx] ?? []).map((c) => String(c ?? '').toLowerCase().trim());
    const findCol = (...needles: string[]) => header.findIndex((h) => needles.some((n) => h.includes(n)));
    const orderColExplicit = findCol('nr zam', 'nr zamów');
    const amountColExplicit = findCol('kwota', 'wartość', 'wartosc');
    const dateColExplicit = (() => {
      let i = findCol('data zł', 'data zl', 'data złoż', 'data zloz', 'data złoz');
      if (i < 0) i = header.findIndex((h) => h === 'data' || h.startsWith('data '));
      return i;
    })();
    const bookedColExplicit = findCol('zaksięg', 'zaksieg', 'księgow', 'ksiegow');
    const cOrder = orderColExplicit >= 0 ? orderColExplicit : 0;
    const cAmount = amountColExplicit >= 0 ? amountColExplicit : 1;
    const cDate = dateColExplicit >= 0 ? dateColExplicit : 3;
    const cBooked = bookedColExplicit >= 0 ? bookedColExplicit : 5;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const date = parseDate(row[cDate], tabHint);
      if (!date) {
        const orderId = String(row[cOrder] ?? '').trim();
        const hasAmount = parseAmount(row[cAmount]) > 0;
        if (orderId || hasAmount) result.rowsSkippedNoDate += 1; // a row that looks like an order but has no usable date
        continue;
      }
      const orderId = String(row[cOrder] ?? '').trim();
      const amount = parseAmount(row[cAmount]);
      if (orderId) {
        const key = `${orderId}|${date}|${amount.toFixed(2)}`;
        if (seen.has(key)) {
          result.rowsDeduped += 1;
          continue;
        }
        seen.add(key);
      }
      const booked = String(row[cBooked] ?? '').trim().toUpperCase() === 'TAK';
      const agg = result.byDate.get(date) ?? { orders: 0, revenue: 0, bookedOrders: 0, bookedRevenue: 0 };
      agg.orders += 1;
      agg.revenue += amount;
      if (booked) {
        agg.bookedOrders += 1;
        agg.bookedRevenue += amount;
      }
      result.byDate.set(date, agg);
      result.rowsParsed += 1;
    }
  }

  return result;
}

export async function syncShowroomSales() {
  const db = getSupabaseAdmin();
  const out: Record<string, { days: number; orders: number; revenue: number; skippedNoDate: number; deduped: number; error?: string }> = {};

  for (const showroom of SALES_SHOWROOMS) {
    const sheetId = SALES_SHEETS[showroom]!;
    try {
      const { byDate, rowsParsed, rowsSkippedNoDate, rowsDeduped } = await readSheetSales(sheetId);
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
      out[showroom] = {
        days: rows.length,
        orders: rowsParsed,
        revenue: Math.round(rows.reduce((s, r) => s + r.revenue_pln, 0) * 100) / 100,
        skippedNoDate: rowsSkippedNoDate,
        deduped: rowsDeduped,
      };
    } catch (e) {
      out[showroom] = { days: 0, orders: 0, revenue: 0, skippedNoDate: 0, deduped: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return out;
}
