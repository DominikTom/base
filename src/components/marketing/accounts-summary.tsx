'use client';

import { formatCurrency, formatNumber, cn } from '@/lib/utils';
import type { AttributionWindow } from '@/lib/marketing-constants';
import { DeltaBadge } from './controls';
import { attributed, type AccountRow, type AdsPayload } from './types';

const SHOP_BADGE: Record<string, string> = {
  'mybed.pl': 'bg-violet-600',
  'mybed.de': 'bg-blue-600',
  'mittohome.pl': 'bg-lime-600',
};

function initials(shop: string): string {
  return shop.replace(/\..*$/, '').slice(0, 2).toUpperCase();
}

// Nagłówkowe KPI + karty per konto reklamowe (jak w narzędziu agencji):
// te same wskaźniki rozbite per konto, z deltą okres-do-okresu.
export function AccountsSummary({
  data, attribution,
}: {
  data: AdsPayload;
  attribution: AttributionWindow;
}) {
  const t = data.totals;
  const att = attributed(t, attribution);

  return (
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <TotalCard label="Wydatki łącznie" value={formatCurrency(t.spend)} delta={t.deltas.spend} deltaInvert
          sub={`${data.period.from} – ${data.period.to}`} />
        <TotalCard label="Przychód z reklam" value={formatCurrency(att.revenue)} delta={t.deltas.revenue}
          sub="wg wybranej atrybucji" />
        <TotalCard label="Blended ROAS" value={`${att.roas.toFixed(2)}×`} delta={t.deltas.roas}
          sub="ważony wydatkami" />
        <TotalCard label="Zakupy" value={formatNumber(att.purchases)} delta={t.deltas.purchases}
          sub={t.leads > 0 ? `+ ${formatNumber(t.leads)} leadów` : undefined} />
      </div>

      {/* Awareness / engagement / leads — feedback Kamili */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MiniStat label="Zasięg*" value={formatNumber(t.reach)} delta={t.deltas.reach} />
        <MiniStat label="Częstotliwość*" value={t.frequency.toFixed(2)} />
        <MiniStat label="CPM" value={`${t.cpm.toFixed(2)} zł`} delta={t.deltas.cpm} invert />
        <MiniStat label="Leady" value={formatNumber(t.leads)} delta={t.deltas.leads} />
        <MiniStat label="Koszt / lead" value={t.leads > 0 ? `${t.cpl.toFixed(2)} zł` : '—'} delta={t.deltas.cpl} invert />
      </div>
      <p className="text-[11px] text-zinc-600 -mt-2">
        * Zasięg to suma dziennych zasięgów (Meta deduplikuje tylko w obrębie dnia) — traktuj jako przybliżenie.
      </p>

      {/* Per account */}
      <div className="space-y-3">
        {data.accounts.map(acc => <AccountCard key={acc.accountId} acc={acc} attribution={attribution} />)}
      </div>
    </div>
  );
}

function TotalCard({ label, value, delta, deltaInvert, sub }: {
  label: string; value: string; delta: number | null; deltaInvert?: boolean; sub?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-2xl font-bold text-zinc-100 mt-1">{value}</div>
      <div className="flex items-center gap-2 mt-1.5">
        <DeltaBadge value={delta} invert={deltaInvert} />
        {sub && <span className="text-[11px] text-zinc-600">{sub}</span>}
      </div>
    </div>
  );
}

function MiniStat({ label, value, delta, invert }: {
  label: string; value: string; delta?: number | null; invert?: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-lg font-semibold text-zinc-100 mt-0.5">{value}</div>
      {delta !== undefined && <div className="mt-1"><DeltaBadge value={delta} invert={invert} /></div>}
    </div>
  );
}

function AccountCard({ acc, attribution }: { acc: AccountRow; attribution: AttributionWindow }) {
  const att = attributed(acc, attribution);
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4 items-center">
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn(
          'w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0',
          SHOP_BADGE[acc.shop] || 'bg-zinc-700'
        )}>
          {initials(acc.shop)}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-zinc-100 truncate">{acc.shop}</div>
          <div className="text-[11px] text-zinc-500">Meta Ads{acc.currency && acc.currency !== 'PLN' ? ` · ${acc.currency}` : ''}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <AccountMetric label="Wydatki" value={formatCurrency(acc.spend)} delta={acc.deltas?.spend} invert />
        <AccountMetric label="Przychód" value={formatCurrency(att.revenue)} delta={acc.deltas?.revenue} />
        <AccountMetric label="ROAS" value={`${att.roas.toFixed(2)}×`} delta={acc.deltas?.roas} />
        <AccountMetric label="Zakupy" value={formatNumber(att.purchases)} delta={acc.deltas?.purchases} />
        <AccountMetric label="Zasięg" value={formatNumber(acc.reach)} delta={acc.deltas?.reach} />
        <AccountMetric label="CPM" value={`${acc.cpm.toFixed(2)} zł`} delta={acc.deltas?.cpm} invert />
        <AccountMetric label="Leady / CPL" value={acc.leads > 0 ? `${formatNumber(acc.leads)} / ${acc.cpl.toFixed(0)} zł` : '—'} delta={acc.deltas?.leads} />
      </div>
    </div>
  );
}

function AccountMetric({ label, value, delta, invert }: {
  label: string; value: string; delta?: number | null; invert?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-sm font-semibold text-zinc-100 mt-0.5">{value}</div>
      <div className="mt-0.5"><DeltaBadge value={delta} invert={invert} /></div>
    </div>
  );
}
