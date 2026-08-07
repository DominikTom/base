import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getAdAccountIds } from '@/lib/meta-ads';
import { META_ACCOUNT_TO_SHOP } from '@/lib/marketing-ads';

// GET /api/etl/meta-ad-sync/plan?days=N
//
// Plan inteligentnego syncu: dla każdego konta sprawdza w bazie, których dat
// z okna [dziś-N, wczoraj] brakuje, i zwraca TYLKO brakujące zakresy (sklejone
// z sąsiadujących dni, pocięte na kawałki ≤30 dni) plus „ogon świeżości" —
// ostatnie FRESH_DAYS dni zawsze do odświeżenia, bo Meta dolicza konwersje
// do ~72 h wstecz. Dzięki temu przycisk syncu nie nadpisuje całości i nie
// pali limitu API na dane, które już mamy.

const FRESH_DAYS = 3;
const MAX_RANGE_DAYS = 30;

const fmt = (d: Date) => d.toISOString().split('T')[0];

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return fmt(d);
}

// Skleja posortowane daty ISO w ciągłe zakresy i tnie na ≤MAX_RANGE_DAYS
function datesToRanges(dates: string[]): Array<{ since: string; until: string }> {
  const ranges: Array<{ since: string; until: string }> = [];
  let start: string | null = null;
  let prev: string | null = null;
  const flush = () => {
    if (!start || !prev) return;
    // podział długiego zakresu na kawałki ≤30 dni
    let s = start;
    while (s <= prev) {
      const chunkEnd = addDays(s, MAX_RANGE_DAYS - 1);
      ranges.push({ since: s, until: chunkEnd < prev ? chunkEnd : prev });
      s = addDays(chunkEnd, 1);
    }
  };
  for (const date of dates) {
    if (prev !== null && date === addDays(prev, 1)) {
      prev = date;
      continue;
    }
    flush();
    start = date;
    prev = date;
  }
  flush();
  return ranges;
}

export async function GET(request: NextRequest) {
  const _guard = await requireAdmin();
  if (_guard) return _guard;

  try {
    const { searchParams } = new URL(request.url);
    const daysParam = parseInt(searchParams.get('days') || '90', 10);
    const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 730 ? daysParam : 90;

    const today = new Date();
    const to = new Date(today);
    to.setDate(to.getDate() - 1);
    const from = new Date(today);
    from.setDate(from.getDate() - days);
    const fromStr = fmt(from);
    const toStr = fmt(to);

    // Wszystkie daty okna (od najstarszej)
    const allDates: string[] = [];
    for (let d = fromStr; d <= toStr; d = addDays(d, 1)) allDates.push(d);
    const freshCutoff = addDays(toStr, -(FRESH_DAYS - 1));

    const db = getSupabaseAdmin();
    const accounts = [];

    for (const accountId of getAdAccountIds()) {
      const { data: covered, error } = await db.rpc('ad_sync_dates_covered', {
        p_account_id: accountId,
        p_from: fromStr,
        p_to: toStr,
      });
      if (error) throw new Error(`ad_sync_dates_covered(${accountId}): ${error.message}`);

      const coveredSet = new Set((covered || []).map(
        (r: { covered_date: string }) => r.covered_date
      ));
      // Do pobrania: brakujące dni + ogon świeżości (restatement Mety)
      const toSync = allDates.filter(d => !coveredSet.has(d) || d >= freshCutoff);

      accounts.push({
        accountId,
        shop: META_ACCOUNT_TO_SHOP[accountId] || accountId,
        missingDays: allDates.filter(d => !coveredSet.has(d)).length,
        ranges: datesToRanges(toSync),
      });
    }

    return NextResponse.json({
      period: { from: fromStr, to: toStr },
      freshDays: FRESH_DAYS,
      accounts,
    });
  } catch (err) {
    console.error('meta-ad-sync plan error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
