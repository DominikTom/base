import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, isAdmin } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { validateQuerySpec, type QuerySpec } from '@/lib/explorer-whitelist';

const TIERS = ['core', 'standard', 'experimental'];
const VALUE_TYPES = ['currency', 'number', 'percent', 'ratio'];

function normalizeSpec(raw: unknown): QuerySpec {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    chart_type: String(s.chart_type || 'bar'),
    x_axis: String(s.x_axis || 'date'),
    y_axis: String(s.y_axis || 'revenue_gross'),
    group_by: s.group_by ? String(s.group_by) : '',
    granularity: String(s.granularity || 'month'),
    filters_advanced: Array.isArray(s.filters_advanced) ? s.filters_advanced : [],
  };
}

// GET → lista definicji KPI (opcjonalnie ?category=)
export async function GET(request: NextRequest) {
  try {
    const { user } = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const category = new URL(request.url).searchParams.get('category');
    let q = getSupabaseAdmin()
      .from('kpi_definitions')
      .select('*')
      .order('category', { ascending: true })
      .order('name', { ascending: true });
    if (category) q = q.eq('category', category);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ kpis: data || [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// POST → tworzy definicję KPI (każdy zalogowany użytkownik)
export async function POST(request: NextRequest) {
  try {
    const { user } = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'Nazwa KPI jest wymagana' }, { status: 400 });

    const spec = normalizeSpec(body.query_spec);
    const errors = validateQuerySpec(spec);
    if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 400 });

    const { data, error } = await getSupabaseAdmin()
      .from('kpi_definitions')
      .insert({
        name,
        description: typeof body.description === 'string' ? body.description : null,
        category: typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'Ogólne',
        tier: TIERS.includes(body.tier) ? body.tier : 'standard',
        value_type: VALUE_TYPES.includes(body.value_type) ? body.value_type : 'number',
        query_spec: spec,
        created_by: user.id,
      })
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ kpi: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// Czy użytkownik może modyfikować dane KPI: autor lub administrator.
async function canModifyKpi(
  supabase: Awaited<ReturnType<typeof getAuthUser>>['supabase'],
  userId: string,
  kpiId: string,
): Promise<{ ok: boolean; found: boolean }> {
  const { data } = await getSupabaseAdmin()
    .from('kpi_definitions')
    .select('created_by')
    .eq('id', kpiId)
    .single();
  if (!data) return { ok: false, found: false };
  if (data.created_by === userId) return { ok: true, found: true };
  return { ok: await isAdmin(supabase, userId), found: true };
}

// PUT ?id= → aktualizuje definicję KPI (autor lub admin)
export async function PUT(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Brak id' }, { status: 400 });

    const perm = await canModifyKpi(supabase, user.id, id);
    if (!perm.found) return NextResponse.json({ error: 'Nie znaleziono KPI' }, { status: 404 });
    if (!perm.ok) return NextResponse.json({ error: 'Możesz edytować tylko swoje KPI' }, { status: 403 });

    const body = await request.json();
    const spec = normalizeSpec(body.query_spec);
    const errors = validateQuerySpec(spec);
    if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 400 });

    const { data, error } = await getSupabaseAdmin()
      .from('kpi_definitions')
      .update({
        name: typeof body.name === 'string' ? body.name.trim() : undefined,
        description: typeof body.description === 'string' ? body.description : null,
        category: typeof body.category === 'string' && body.category.trim() ? body.category.trim() : 'Ogólne',
        tier: TIERS.includes(body.tier) ? body.tier : 'standard',
        value_type: VALUE_TYPES.includes(body.value_type) ? body.value_type : 'number',
        query_spec: spec,
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ kpi: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// DELETE ?id= → usuwa definicję KPI (autor lub admin)
export async function DELETE(request: NextRequest) {
  try {
    const { user, supabase } = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Brak id' }, { status: 400 });

    const perm = await canModifyKpi(supabase, user.id, id);
    if (!perm.found) return NextResponse.json({ error: 'Nie znaleziono KPI' }, { status: 404 });
    if (!perm.ok) return NextResponse.json({ error: 'Możesz usuwać tylko swoje KPI' }, { status: 403 });

    const { error } = await getSupabaseAdmin().from('kpi_definitions').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
