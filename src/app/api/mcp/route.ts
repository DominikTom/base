import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticateMcpRequest } from '@/lib/mcp/auth';
import { registerTools } from '@/lib/mcp/server';

// Zdalny serwer MCP dash.mybed (Streamable HTTP, tylko odczyt).
// Bezstanowy: każde żądanie dostaje świeży serwer i transport, odpowiedź JSON
// (bez strumienia SSE) — pasuje do funkcji serverless na Vercelu.
// Autoryzacja: `Authorization: Bearer dmcp_…` (token z /dashboard/mcp).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SERVER_INFO = { name: 'dash-mybed', version: '1.0.0' };

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Brak lub nieprawidłowy token. Wygeneruj token w dash: /dashboard/mcp.' }, id: null }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer realm="dash-mybed-mcp"',
      },
    },
  );
}

async function handle(request: Request): Promise<Response> {
  const auth = await authenticateMcpRequest(request);
  if (!auth) return unauthorized();

  const server = new McpServer(SERVER_INFO, {
    instructions:
      'Data Hub MyBed (tylko odczyt): sprzedaż i produkty (ERP), ruch GA4, showroomy, reklamy Meta i kreacje. ' +
      'Kwoty w PLN, dni w strefie Europe/Warsaw; przychód = zamówienia „Zamówienie sprzedaży” + „Zrealizowane” ' +
      '(oferty i anulowane osobno); reklamy domyślnie w atrybucji 7d_click. ' +
      'Sklepy: mybed.pl, mybed.de, mojepostel.cz, mittohome.pl, nomosleep.pl. ' +
      `Twój zakres: ${auth.allowedShops.join(', ')}. Gdy dane wyglądają na stare, zacznij od data_health. ` +
      'To samo jest dostępne jako REST: /api/v1 (specyfikacja /api/v1/openapi.json).',
  });
  registerTools(server, auth);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, {
      authInfo: { token: auth.tokenId, clientId: auth.userId, scopes: ['read'] },
    });
  } finally {
    // Odpowiedź JSON jest już gotowa — sprzątamy serwer tego żądania.
    void server.close().catch(() => {});
  }
}

export { handle as GET, handle as POST, handle as DELETE };
