import { CAPABILITIES } from '@/lib/hub/registry';
import { buildOpenApi } from '@/lib/hub/rest';

// Publiczna specyfikacja OpenAPI Data Hub (bez danych — same opisy zasobów),
// do importu w Postmanie, n8n, Apps Script itp.

export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const base = new URL(request.url).origin;
  return new Response(JSON.stringify(buildOpenApi(CAPABILITIES, base), null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}
