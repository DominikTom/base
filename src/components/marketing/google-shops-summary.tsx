'use client';

import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import { pctChange } from '@/lib/period-compare';
import { DeltaBadge } from './controls';
import { SHOP_BADGE, shopInitials } from './accounts-summary';

// Wiersz per sklep z /api/dashboard/marketing/google (pole `shops`).
// Koszty z GA4 __total__, przychód/transakcje/sesje z atrybucji google/cpc.
export interface GoogleShopRow {
  hostname: string;
  spend: number;
  revenue: number;
  transactions: number;
  sessions: number;
  clicks: number;
  impressions: number;
  roas: number;
  cpc: number;
  ctr: number;
  convRate: number;
}

// Karty per sklep dla Google Ads — ten sam układ co karty kont Meta w
// „Konta & KPI", żeby dało się porównywać sklepy jeden obok drugiego.
// Delty liczone vs poprzedni okres tej samej długości.
export function GoogleShopsSummary({
  shops, prevShops,
}: {
  shops: GoogleShopRow[];
  prevShops: GoogleShopRow[] | null;
}) {
  if (shops.length <= 1) return null;

  const prevBy = new Map((prevShops || []).map(s => [s.hostname, s]));

  return (
    <div className="space-y-3">
      {shops.map(shop => {
        const prev = prevBy.get(shop.hostname);
        return (
          <div
            key={shop.hostname}
            className="card p-4 grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4 items-center"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0',
                SHOP_BADGE[shop.hostname] || 'bg-zinc-500'
              )}>
                {shopInitials(shop.hostname)}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink truncate">{shop.hostname}</div>
                <div className="text-[11px] text-ink-faint">Google Ads · GA4</div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              <ShopMetric label="Wydatki" value={formatCurrency(shop.spend)}
                delta={pctChange(shop.spend, prev?.spend)} invert />
              <ShopMetric label="Przychód" value={formatCurrency(shop.revenue)}
                delta={pctChange(shop.revenue, prev?.revenue)} />
              <ShopMetric label="ROAS" value={`${shop.roas.toFixed(2)}×`}
                delta={pctChange(shop.roas, prev?.roas)} />
              <ShopMetric label="Transakcje" value={formatNumber(shop.transactions)}
                delta={pctChange(shop.transactions, prev?.transactions)} />
              <ShopMetric label="Sesje" value={formatNumber(shop.sessions)}
                delta={pctChange(shop.sessions, prev?.sessions)} />
              <ShopMetric label="CPC" value={`${shop.cpc.toFixed(2)} zł`}
                delta={pctChange(shop.cpc, prev?.cpc)} invert />
              <ShopMetric label="Konwersja" value={`${shop.convRate.toFixed(2)}%`}
                delta={pctChange(shop.convRate, prev?.convRate)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ShopMetric({ label, value, delta, invert }: {
  label: string; value: string; delta: number | null; invert?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium text-ink-muted">{label}</div>
      <div className="font-mono text-sm font-semibold text-ink mt-0.5">{value}</div>
      <div className="mt-0.5"><DeltaBadge value={delta} invert={invert} /></div>
    </div>
  );
}
