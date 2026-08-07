import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { FUNNEL_STAGES, sanitizeTags } from '@/lib/marketing-constants';

// PATCH /api/dashboard/marketing/campaign-meta
// Body: { campaign_id, account_id?, purpose?, funnel_stage?, notes?, tags? }
//
// Edycja pól manualnych kampanii (cel wewnętrzny / etap lejka / notatka /
// własne tagi). Pola z Meta API (objective, status, budżety) nadpisuje
// wyłącznie ETL. Zapis wymaga zalogowanej sesji (zespół marketingu).
export async function PATCH(request: NextRequest) {
  try {
    const { user } = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const body = await request.json();
    const campaignId = typeof body.campaign_id === 'string' ? body.campaign_id.trim() : '';
    if (!campaignId) {
      return NextResponse.json({ error: 'campaign_id required' }, { status: 400 });
    }

    const update: Record<string, string | string[] | null> = {};
    if ('tags' in body) {
      const tags = sanitizeTags(body.tags);
      if (tags === null) {
        return NextResponse.json({ error: 'tags must be an array of short strings (max 15 × 40 znaków)' }, { status: 400 });
      }
      update.manual_tags = tags;
    }
    for (const field of ['purpose', 'notes'] as const) {
      if (field in body) {
        const v = body[field];
        if (v !== null && typeof v !== 'string') {
          return NextResponse.json({ error: `${field} must be string or null` }, { status: 400 });
        }
        update[field] = v === '' ? null : v;
      }
    }
    if ('funnel_stage' in body) {
      const v = body.funnel_stage;
      if (v !== null && v !== '' && !(FUNNEL_STAGES as readonly string[]).includes(v)) {
        return NextResponse.json(
          { error: `funnel_stage must be one of: ${FUNNEL_STAGES.join(', ')}` },
          { status: 400 }
        );
      }
      update.funnel_stage = v === '' ? null : v;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
    }

    const db = getSupabaseAdmin();
    const { data: updated, error } = await db
      .from('dim_campaigns')
      .update(update)
      .eq('campaign_id', campaignId)
      .select('campaign_id')
      .maybeSingle();
    if (error) throw new Error(error.message);

    // Kampania może istnieć w fact_daily_ad_performance zanim ETL zsyncuje
    // dim_campaigns — wtedy zakładamy wiersz z account_id od klienta.
    if (!updated) {
      const accountId = typeof body.account_id === 'string' ? body.account_id.trim() : '';
      if (!accountId) {
        return NextResponse.json({ error: 'campaign not found (account_id required to create)' }, { status: 404 });
      }
      const { error: insErr } = await db
        .from('dim_campaigns')
        .insert({ campaign_id: campaignId, account_id: accountId, ...update });
      if (insErr) throw new Error(insErr.message);
    }

    return NextResponse.json({ success: true, campaign_id: campaignId, ...update });
  } catch (err) {
    console.error('campaign-meta error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
