import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { sanitizeTags } from '@/lib/marketing-constants';

// PATCH /api/dashboard/marketing/creative-meta
// Body: { creative_id, tags?, notes? }
//
// Własne tagi i notatka kreacji (dim_creatives.manual_tags / manual_notes) —
// edytowane z modalu podglądu. Tagi auto (z Meta) i AI zostają nietknięte;
// w widokach filtruje się po unii wszystkich trzech.
export async function PATCH(request: NextRequest) {
  try {
    const { user } = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const body = await request.json();
    const creativeId = typeof body.creative_id === 'string' ? body.creative_id.trim() : '';
    if (!creativeId) {
      return NextResponse.json({ error: 'creative_id required' }, { status: 400 });
    }

    const update: Record<string, string | string[] | null> = {};
    if ('tags' in body) {
      const tags = sanitizeTags(body.tags);
      if (tags === null) {
        return NextResponse.json({ error: 'tags must be an array of short strings (max 15 × 40 znaków)' }, { status: 400 });
      }
      update.manual_tags = tags;
    }
    if ('notes' in body) {
      const v = body.notes;
      if (v !== null && typeof v !== 'string') {
        return NextResponse.json({ error: 'notes must be string or null' }, { status: 400 });
      }
      update.manual_notes = v === '' ? null : v;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
    }

    const { data: updated, error } = await getSupabaseAdmin()
      .from('dim_creatives')
      .update(update)
      .eq('creative_id', creativeId)
      .select('creative_id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) {
      return NextResponse.json({ error: 'creative not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, creative_id: creativeId, ...update });
  } catch (err) {
    console.error('creative-meta error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
