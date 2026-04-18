import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

const TABLES = [
  'fact_orders',
  'fact_order_items',
  'fact_daily_revenue',
  'fact_daily_adspend',
  'fact_daily_traffic',
  'fact_agency_costs',
  'dim_exchange_rates',
  'dim_products',
  'dim_fabrics',
  'etl_log',
  'user_profiles',
  'cache_meta_live',
  'cache_pinterest_live',
  'reconciliation_log',
];

export async function GET(request: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'tables';
    const table = searchParams.get('table');

    if (action === 'tables') {
      const results = [];
      for (const t of TABLES) {
        try {
          const { data: sample, count } = await db.from(t).select('*', { count: 'exact' }).limit(1);
          const columns = sample && sample.length > 0
            ? Object.entries(sample[0]).map(([name, val]) => ({
                name,
                type: val === null ? 'unknown' : typeof val === 'number' ? 'number' : typeof val === 'boolean' ? 'boolean' : typeof val === 'object' ? 'jsonb' : 'text',
              }))
            : [];
          results.push({ name: t, columns, rowCount: count || 0 });
        } catch {
          results.push({ name: t, columns: [], rowCount: 0 });
        }
      }
      return NextResponse.json({ tables: results });
    }

    if (action === 'preview' && table) {
      if (!TABLES.includes(table)) return NextResponse.json({ error: 'Invalid table' }, { status: 400 });

      const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
      const offset = parseInt(searchParams.get('offset') || '0');

      const { data, count } = await db.from(table).select('*', { count: 'exact' }).range(offset, offset + limit - 1);

      const columns = data && data.length > 0
        ? Object.entries(data[0]).map(([name, val]) => ({
            name,
            type: val === null ? 'unknown' : typeof val === 'number' ? 'number' : typeof val === 'boolean' ? 'boolean' : typeof val === 'object' ? 'jsonb' : 'text',
          }))
        : [];

      return NextResponse.json({ table, data: data || [], columns, totalCount: count || 0, offset, limit });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
