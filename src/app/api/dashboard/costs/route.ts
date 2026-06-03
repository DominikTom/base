import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET() {
  try {
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from('fact_agency_costs')
      .select('*')
      .order('month', { ascending: false })
      .limit(500);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ costs: data || [] });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    const body = await request.json();

    if (body.action === 'add') {
      const { error } = await db.from('fact_agency_costs').insert({
        month: body.month,
        agency_name: body.agency_name,
        service_type: body.service_type,
        amount_pln: body.amount_pln,
        notes: body.notes,
        source_shop: body.source_shop || null,
        platform: body.platform || null,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    if (body.action === 'delete') {
      const { error } = await db.from('fact_agency_costs').delete().eq('id', body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
