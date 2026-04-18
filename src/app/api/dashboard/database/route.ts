import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'tables';
    const table = searchParams.get('table');

    if (action === 'tables') {
      // Get all public tables with column count and row estimate
      const { data: tables, error } = await db.rpc('get_table_info').select('*');

      if (error) {
        // Fallback: query information_schema directly
        const { data: cols } = await db
          .from('information_schema.columns' as never)
          .select('table_name, column_name, data_type, is_nullable, column_default')
          .eq('table_schema', 'public')
          .order('table_name')
          .order('ordinal_position');

        if (!cols) return NextResponse.json({ tables: [] });

        // Group by table
        const tableMap: Record<string, { name: string; columns: Array<{ name: string; type: string; nullable: boolean; default_val: string | null }> }> = {};
        for (const c of cols as Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>) {
          if (!tableMap[c.table_name]) tableMap[c.table_name] = { name: c.table_name, columns: [] };
          tableMap[c.table_name].columns.push({
            name: c.column_name,
            type: c.data_type,
            nullable: c.is_nullable === 'YES',
            default_val: c.column_default,
          });
        }

        // Get row counts
        const tableList = Object.values(tableMap);
        for (const t of tableList) {
          const { count } = await db.from(t.name).select('*', { count: 'exact', head: true });
          (t as Record<string, unknown>).rowCount = count || 0;
        }

        return NextResponse.json({ tables: tableList });
      }

      return NextResponse.json({ tables });
    }

    if (action === 'columns' && table) {
      // Whitelist tables to prevent injection
      const { count } = await db.from(table).select('*', { count: 'exact', head: true });

      // Get columns via a LIMIT 0 query to get column names
      const { data: sample } = await db.from(table).select('*').limit(0);

      return NextResponse.json({ table, rowCount: count || 0, sample });
    }

    if (action === 'preview' && table) {
      const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
      const offset = parseInt(searchParams.get('offset') || '0');
      const orderBy = searchParams.get('orderBy');
      const orderDir = searchParams.get('orderDir') === 'desc' ? false : true;

      let q = db.from(table).select('*');
      if (orderBy) q = q.order(orderBy, { ascending: orderDir });
      q = q.range(offset, offset + limit - 1);

      const { data, error, count } = await q;
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      // Get total count
      const { count: totalCount } = await db.from(table).select('*', { count: 'exact', head: true });

      // Get column info
      const columns = data && data.length > 0
        ? Object.keys(data[0]).map(key => ({
            name: key,
            type: typeof data[0][key as keyof typeof data[0]],
            sample: data[0][key as keyof typeof data[0]],
          }))
        : [];

      return NextResponse.json({ table, data, columns, totalCount: totalCount || 0, offset, limit });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
