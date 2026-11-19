import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase';
import type { McpAuthContext } from '@/lib/mcp/auth';

// Jądro Data Hub MyBed: każda zdolność (np. „wyniki reklam”, „sprzedaż”) jest
// zdefiniowana RAZ — schemat wejścia (zod), opis i funkcja run — a wystawiana
// dwoma drzwiami: REST GET /api/v1/<path> i narzędzie MCP <name>. Autoryzacja,
// zakres sklepów, walidacja i audyt są wspólne (executeCapability).

/** Błąd z kodem HTTP — REST zwraca ten status, MCP treść jako isError. */
export class HubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HubError';
  }
}

export const badRequest = (msg: string) => new HubError(400, msg);
export const forbidden = (msg: string) => new HubError(403, msg);
export const notFound = (msg: string) => new HubError(404, msg);

export interface HubContext {
  db: SupabaseClient;
  auth: McpAuthContext;
}

export interface CapabilityResult {
  payload: Record<string, unknown>;
  rows: number;
}

export interface Capability {
  /** Nazwa narzędzia MCP (snake_case). */
  name: string;
  /** Ścieżka REST pod /api/v1, segmenty {param} = parametry ścieżki. */
  path: string;
  /** Grupa w dokumentacji OpenAPI. */
  tag: string;
  title: string;
  description: string;
  input: z.ZodRawShape;
  run: (ctx: HubContext, args: Record<string, unknown>) => Promise<CapabilityResult>;
}

/** Pomocnik typujący argumenty run() według schematu wejścia. */
export function defineCapability<S extends z.ZodRawShape>(def: {
  name: string;
  path: string;
  tag: string;
  title: string;
  description: string;
  input: S;
  run: (ctx: HubContext, args: z.infer<z.ZodObject<S>>) => Promise<CapabilityResult>;
}): Capability {
  return def as unknown as Capability;
}

function formatZodError(err: z.ZodError): string {
  return err.issues
    .map(i => `${i.path.join('.') || 'argumenty'}: ${i.message}`)
    .join('; ');
}

async function audit(db: SupabaseClient, auth: McpAuthContext, tool: string, args: unknown, rows: number | null, ms: number, error: string | null) {
  try {
    await db.from('mcp_audit').insert({
      token_id: auth.tokenId, user_id: auth.userId, tool, args: args ?? null, rows, duration_ms: ms, error,
    });
  } catch { /* audyt nie może zablokować odpowiedzi */ }
}

/**
 * Wykonuje zdolność: walidacja → run → audyt. Zwraca payload albo rzuca HubError.
 * channel trafia do audytu jako prefiks („rest:” dla REST).
 */
export async function executeCapability(
  cap: Capability,
  auth: McpAuthContext,
  rawArgs: unknown,
  channel: 'mcp' | 'rest',
): Promise<Record<string, unknown>> {
  const db = getSupabaseAdmin();
  const started = Date.now();
  const toolLabel = channel === 'rest' ? `rest:${cap.name}` : cap.name;
  const parsed = z.object(cap.input).safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const msg = formatZodError(parsed.error);
    await audit(db, auth, toolLabel, rawArgs, null, Date.now() - started, msg);
    throw badRequest(msg);
  }
  try {
    const { payload, rows } = await cap.run({ db, auth }, parsed.data);
    await audit(db, auth, toolLabel, parsed.data, rows, Date.now() - started, null);
    return payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await audit(db, auth, toolLabel, parsed.data, null, Date.now() - started, message);
    if (err instanceof HubError) throw err;
    throw new HubError(500, message);
  }
}
