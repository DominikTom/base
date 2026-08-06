import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { getSupabaseAdmin } from '@/lib/supabase';
import {
  fetchAdPerfRows, shopFilterToAccountIds,
  aggregateCampaigns, aggregateAdsets, aggregateAds,
  META_ACCOUNT_TO_SHOP, type FinalizedMetrics,
} from '@/lib/marketing-ads';

// GET /api/dashboard/marketing/export?scope=campaigns|adsets|ads|daily&date_from&date_to&shop
//
// Eksport CSV z zachowaniem zakresu dat i filtra sklepu (te same parametry co
// dashboard). Format przyjazny polskiemu Excelowi: separator ';', przecinek
// dziesiętny, BOM UTF-8. Zakres dat trafia też do nazwy pliku.

const SCOPES = ['campaigns', 'adsets', 'ads', 'daily'] as const;
type Scope = (typeof SCOPES)[number];

// Liczby z przecinkiem dziesiętnym — inaczej polski Excel czyta '12.45' jako tekst
const num = (v: number | null | undefined): string =>
  v === null || v === undefined ? '' : String(v).replace('.', ',');

function metricColumns(m: FinalizedMetrics) {
  return {
    'Wydatki (PLN)': num(m.spend),
    'Wyświetlenia': m.impressions,
    'Zasięg': m.reach,
    'Częstotliwość': num(m.frequency),
    'Kliknięcia': m.clicks,
    'CTR (%)': num(m.ctr),
    'CPC (PLN)': num(m.cpc),
    'CPM (PLN)': num(m.cpm),
    'Zakupy': m.purchases,
    'Przychód (PLN)': num(m.revenue),
    'ROAS': num(m.roas),
    'Koszt/zakup (PLN)': num(m.costPerPurchase),
    'Leady': m.leads,
    'Koszt/lead (PLN)': num(m.cpl),
    'Zakupy 1d klik': m.attribution['1d_click'].purchases,
    'Przychód 1d klik (PLN)': num(m.attribution['1d_click'].revenue),
    'ROAS 1d klik': num(m.attribution['1d_click'].roas),
    'Zakupy 7d klik': m.attribution['7d_click'].purchases,
    'Przychód 7d klik (PLN)': num(m.attribution['7d_click'].revenue),
    'ROAS 7d klik': num(m.attribution['7d_click'].roas),
    'Zakupy 1d view': m.attribution['1d_view'].purchases,
    'Przychód 1d view (PLN)': num(m.attribution['1d_view'].revenue),
    'ROAS 1d view': num(m.attribution['1d_view'].roas),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const scope = (searchParams.get('scope') || 'campaigns') as Scope;
    const dateFrom = searchParams.get('date_from') || '2025-01-01';
    const dateTo = searchParams.get('date_to') || new Date().toISOString().split('T')[0];
    const shop = searchParams.get('shop') || 'all';

    if (!SCOPES.includes(scope)) {
      return NextResponse.json({ error: `scope must be one of: ${SCOPES.join(', ')}` }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
    }

    // Multi-select sklepów: filters.shop bywa CSV ('mybed.pl,mybed.de')
    const rows = await fetchAdPerfRows(dateFrom, dateTo, shopFilterToAccountIds(shop));

    let records: Record<string, string | number>[] = [];

    if (scope === 'campaigns') {
      // Join z dim_campaigns — cel, etap lejka i notatki mają być w eksporcie
      const campaigns = aggregateCampaigns(rows);
      const meta = new Map<string, Record<string, unknown>>();
      const ids = campaigns.map(c => c.campaignId);
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await getSupabaseAdmin()
          .from('dim_campaigns')
          .select('campaign_id, objective, effective_status, purpose, funnel_stage, notes')
          .in('campaign_id', ids.slice(i, i + 200));
        for (const r of data || []) meta.set(r.campaign_id as string, r);
      }
      records = campaigns.map(c => {
        const m = meta.get(c.campaignId);
        return {
          'Sklep': c.shop,
          'Kampania': c.campaignName,
          'ID kampanii': c.campaignId,
          'Cel Meta (objective)': (m?.objective as string) || '',
          'Status': (m?.effective_status as string) || '',
          'Cel wewnętrzny': (m?.purpose as string) || '',
          'Etap lejka': (m?.funnel_stage as string) || '',
          'Notatka': (m?.notes as string) || '',
          ...metricColumns(c),
        };
      });
    } else if (scope === 'adsets') {
      records = aggregateAdsets(rows).map(a => ({
        'Sklep': a.shop,
        'Kampania': a.campaignName,
        'Zestaw reklam': a.adsetName,
        'ID zestawu': a.adsetId,
        ...metricColumns(a),
      }));
    } else if (scope === 'ads') {
      records = aggregateAds(rows).map(a => ({
        'Sklep': a.shop,
        'Kampania': a.campaignName,
        'Zestaw reklam': a.adsetName,
        'Reklama': a.adName,
        'ID reklamy': a.adId,
        'Hook rate (%)': num(a.hookRate),
        'Thruplays': a.thruplays,
        ...metricColumns(a),
      }));
    } else {
      // daily — surowe wiersze dzienne ad-level (do pivotów)
      records = rows.map(r => ({
        'Data': r.date,
        'Sklep': META_ACCOUNT_TO_SHOP[r.account_id] || r.account_id,
        'Kampania': r.campaign_name || r.campaign_id,
        'Zestaw reklam': r.adset_name || r.adset_id,
        'Reklama': r.ad_name || r.ad_id,
        'Wydatki (PLN)': num(Math.round((r.spend || 0) * 100) / 100),
        'Wyświetlenia': r.impressions || 0,
        'Zasięg': r.reach || 0,
        'Kliknięcia': r.clicks || 0,
        'Zakupy': r.conversions || 0,
        'Przychód (PLN)': num(Math.round((r.conversion_value || 0) * 100) / 100),
        'Leady': r.leads || 0,
      }));
    }

    // Separator ';' — domyślny separator list w polskim Excelu; BOM dla poprawnych
    // polskich znaków. Zakres dat w nazwie pliku.
    const csv = '\uFEFF' + Papa.unparse(records, { delimiter: ';' });
    const filename = `meta_ads_${scope}_${dateFrom}_${dateTo}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('marketing export error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
