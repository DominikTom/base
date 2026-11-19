import { createHash, randomBytes } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/supabase';
import { MCP_SHOPS, isMcpShop, type McpShop } from './shops';

// Tokeny MCP: `dmcp_` + 32 losowe bajty (base64url). W bazie tylko SHA-256,
// więc wyciek tabeli mcp_tokens nie daje dostępu. Token pokazujemy raz, przy
// utworzeniu. Klucz service role Supabase zostaje na serwerze.

export const TOKEN_PREFIX = 'dmcp_';
const DISPLAY_PREFIX_LEN = 12;

export function generateToken(): { token: string; hash: string; displayPrefix: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token), displayPrefix: token.slice(0, DISPLAY_PREFIX_LEN) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface McpAuthContext {
  tokenId: string;
  userId: string;
  email: string;
  role: 'admin' | 'viewer';
  allowedShops: McpShop[];
}

/** Sklepy dla roli: admin — wszystkie; viewer — allowed_shops (NULL = wszystkie). */
export function allowedShopsForProfile(role: string | null | undefined, allowed: string[] | null | undefined): McpShop[] {
  if (role === 'admin' || allowed == null) return [...MCP_SHOPS];
  return allowed.filter(isMcpShop);
}

export function bearerFromRequest(req: Request): string | null {
  const header = req.headers.get('authorization') || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;
  return match[1].startsWith(TOKEN_PREFIX) ? match[1] : null;
}

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export async function authenticateMcpRequest(req: Request): Promise<McpAuthContext | null> {
  const token = bearerFromRequest(req);
  if (!token) return null;

  const db = getSupabaseAdmin();
  const { data: row, error } = await db
    .from('mcp_tokens')
    .select('id, user_id, expires_at, revoked_at, last_used_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (error || !row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;

  const { data: profile } = await db
    .from('user_profiles')
    .select('email, role, allowed_shops')
    .eq('user_id', row.user_id)
    .maybeSingle();
  if (!profile) return null;

  // last_used_at nie przy każdym wywołaniu — wystarczy z dokładnością do 5 min.
  const lastUsed = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
  if (Date.now() - lastUsed > TOUCH_INTERVAL_MS) {
    await db.from('mcp_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', row.id);
  }

  return {
    tokenId: row.id as string,
    userId: row.user_id as string,
    email: (profile.email as string) || '',
    role: profile.role === 'admin' ? 'admin' : 'viewer',
    allowedShops: allowedShopsForProfile(profile.role as string, profile.allowed_shops as string[] | null),
  };
}
