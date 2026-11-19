import { authenticateMcpRequest } from '@/lib/mcp/auth';
import { executeCapability, HubError } from '@/lib/hub/core';
import { CAPABILITIES } from '@/lib/hub/registry';
import { coerceArgs, matchCapability } from '@/lib/hub/rest';

// Data Hub MyBed — REST API (tylko odczyt), GET /api/v1/<zasób>.
// Te same zdolności, uprawnienia i audyt co serwer MCP (/api/mcp).
// Autoryzacja: `Authorization: Bearer dmcp_…` (token z /dashboard/mcp).
// Specyfikacja: /api/v1/openapi.json

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', ...extra },
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const auth = await authenticateMcpRequest(request);
  if (!auth) {
    return json({ error: 'Brak lub nieprawidłowy token. Wygeneruj token w dash: /dashboard/mcp.' }, 401, {
      'www-authenticate': 'Bearer realm="data-hub-mybed"',
    });
  }

  const { path } = await ctx.params;
  const segments = (path || []).filter(Boolean);
  if (segments.length === 0) {
    return json({
      name: 'Data Hub MyBed API',
      openapi: '/api/v1/openapi.json',
      your_shops: auth.allowedShops,
      endpoints: CAPABILITIES.map(c => ({ path: `/api/v1/${c.path}`, name: c.name, title: c.title })),
    });
  }

  const match = matchCapability(CAPABILITIES, segments);
  if (!match) return json({ error: `Nieznany zasób /api/v1/${segments.join('/')}. Lista: /api/v1` }, 404);

  const query: Record<string, string> = {};
  new URL(request.url).searchParams.forEach((value, key) => { query[key] = value; });
  const args = coerceArgs(match.cap.input, { ...query, ...match.params });

  try {
    const payload = await executeCapability(match.cap, auth, args, 'rest');
    return json(payload);
  } catch (err) {
    const status = err instanceof HubError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : String(err) }, status);
  }
}

export async function POST(): Promise<Response> {
  return json({ error: 'API jest tylko do odczytu — użyj GET.' }, 405, { allow: 'GET' });
}
