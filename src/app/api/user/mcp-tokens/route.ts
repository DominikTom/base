import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { generateToken, allowedShopsForProfile } from '@/lib/mcp/auth';
import { isMcpShop, MCP_SHOPS } from '@/lib/mcp/shops';

// Tokeny MCP zalogowanego użytkownika (/dashboard/mcp).
//   GET                                   — moje tokeny, mój zakres sklepów; admin: lista użytkowników
//   POST {action:'create', name, expires_days?} — nowy token (wartość zwracana tylko raz)
//   POST {action:'revoke', id}            — odwołanie (własny token; admin: dowolny)
//   POST {action:'set_shops', user_id, allowed_shops: string[] | null} — tylko admin
// Zapis przez service role: tabela mcp_tokens nie ma polityk RLS (migracja 025).

const MAX_ACTIVE_TOKENS = 10;

async function currentUser() {
  const { user } = await getAuthUser();
  if (!user) return null;
  const { data: profile } = await getSupabaseAdmin()
    .from('user_profiles')
    .select('role, allowed_shops, email')
    .eq('user_id', user.id)
    .maybeSingle();
  return {
    id: user.id,
    email: user.email || '',
    isAdmin: profile?.role === 'admin',
    allowedShops: allowedShopsForProfile(profile?.role as string, profile?.allowed_shops as string[] | null),
  };
}

export async function GET() {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const db = getSupabaseAdmin();

  const { data: tokens, error } = await db
    .from('mcp_tokens')
    .select('id, name, token_prefix, created_at, last_used_at, expires_at, revoked_at')
    .eq('user_id', me.id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let users: unknown[] | undefined;
  if (me.isAdmin) {
    const { data } = await db.from('user_profiles').select('user_id, email, role, allowed_shops').order('email');
    users = data || [];
  }

  return NextResponse.json({
    tokens: tokens || [],
    me: { email: me.email, isAdmin: me.isAdmin, allowedShops: me.allowedShops },
    shops: MCP_SHOPS,
    users,
  });
}

export async function POST(request: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const db = getSupabaseAdmin();
  const body = await request.json().catch(() => ({}));

  if (body.action === 'create') {
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) return NextResponse.json({ error: 'Podaj nazwę tokenu (np. „Claude — laptop”).' }, { status: 400 });
    const days = body.expires_days == null ? null : Number(body.expires_days);
    if (days != null && (!Number.isInteger(days) || days < 1 || days > 730)) {
      return NextResponse.json({ error: 'Ważność: 1–730 dni albo bez terminu.' }, { status: 400 });
    }
    const { count } = await db.from('mcp_tokens').select('id', { count: 'exact', head: true })
      .eq('user_id', me.id).is('revoked_at', null);
    if ((count ?? 0) >= MAX_ACTIVE_TOKENS) {
      return NextResponse.json({ error: `Masz już ${MAX_ACTIVE_TOKENS} aktywnych tokenów — odwołaj nieużywane.` }, { status: 400 });
    }
    const { token, hash, displayPrefix } = generateToken();
    const expiresAt = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
    const { data, error } = await db.from('mcp_tokens').insert({
      user_id: me.id, name, token_prefix: displayPrefix, token_hash: hash, expires_at: expiresAt,
    }).select('id, name, token_prefix, created_at, expires_at').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ token, record: data });
  }

  if (body.action === 'revoke') {
    const id = String(body.id || '');
    let q = db.from('mcp_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', id).is('revoked_at', null);
    if (!me.isAdmin) q = q.eq('user_id', me.id);
    const { data, error } = await q.select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) return NextResponse.json({ error: 'Nie znaleziono aktywnego tokenu.' }, { status: 404 });
    return NextResponse.json({ success: true });
  }

  if (body.action === 'set_shops') {
    if (!me.isAdmin) return NextResponse.json({ error: 'Forbidden — wymagana rola admin' }, { status: 403 });
    const userId = String(body.user_id || '');
    let shops: string[] | null = null;
    if (body.allowed_shops !== null) {
      if (!Array.isArray(body.allowed_shops) || !body.allowed_shops.every((s: unknown) => typeof s === 'string' && isMcpShop(s))) {
        return NextResponse.json({ error: `allowed_shops: lista z ${MCP_SHOPS.join(', ')} albo null (wszystkie).` }, { status: 400 });
      }
      shops = [...new Set(body.allowed_shops as string[])];
    }
    const { error } = await db.from('user_profiles').update({ allowed_shops: shops }).eq('user_id', userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
