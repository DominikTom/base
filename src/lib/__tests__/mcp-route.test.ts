import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp/auth';

// Test endpointu /api/mcp bez bazy: autoryzacja i klient Supabase są podmienione.
// Sprawdza handshake MCP, listę narzędzi i odmowę dla sklepu spoza zakresu.

const auditInserts: unknown[] = [];
let ctx: McpAuthContext | null = null;

vi.mock('@/lib/mcp/auth', () => ({
  authenticateMcpRequest: vi.fn(async () => ctx),
}));
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ insert: async (row: unknown) => { auditInserts.push(row); return { error: null }; } }),
  }),
}));

const { POST } = await import('@/app/api/mcp/route');

function rpc(method: string, params: Record<string, unknown> = {}, id = 1) {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer dmcp_test',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}

beforeEach(() => {
  auditInserts.length = 0;
  ctx = { tokenId: 't1', userId: 'u1', email: 'test@mybed.pl', role: 'viewer', allowedShops: ['mybed.de'] };
});

describe('/api/mcp', () => {
  it('bez tokenu zwraca 401 z WWW-Authenticate', async () => {
    ctx = null;
    const res = await POST(rpc('tools/list'));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/Bearer/);
  });

  it('initialize zwraca nazwę serwera i instrukcje z zakresem sklepów', async () => {
    const res = await POST(rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe('dash-mybed');
    expect(body.result.instructions).toContain('mybed.de');
  });

  it('tools/list zwraca wszystkie zdolności Data Hub tylko do odczytu', async () => {
    const res = await POST(rpc('tools/list'));
    const body = await res.json();
    const names = body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      'ads_performance', 'assets_search', 'campaigns_list', 'creative_detail',
      'creative_fatigue', 'creatives_list', 'data_health',
      'products_ranking', 'sales_summary', 'showrooms_summary', 'traffic_sources', 'traffic_summary',
    ]);
    for (const t of body.result.tools) expect(t.annotations.readOnlyHint).toBe(true);
    const ads = body.result.tools.find((t: { name: string }) => t.name === 'ads_performance');
    expect(ads.inputSchema.properties.attribution.enum).toEqual(['7d_click', '1d_click', '1d_view']);
    expect(ads.inputSchema.required).toEqual(expect.arrayContaining(['date_from', 'date_to']));
  });

  it('odmawia sklepu spoza zakresu użytkownika i zapisuje audyt', async () => {
    const res = await POST(rpc('tools/call', {
      name: 'ads_performance',
      arguments: { shop: 'mybed.pl', date_from: '2026-11-01', date_to: '2026-11-18' },
    }));
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/Brak dostępu do sklepu mybed\.pl/);
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({ tool: 'ads_performance', user_id: 'u1' });
  });

  it('waliduje format daty', async () => {
    const res = await POST(rpc('tools/call', {
      name: 'ads_performance',
      arguments: { date_from: '1.11.2026', date_to: '2026-11-18' },
    }));
    const body = await res.json();
    const failed = body.error || body.result?.isError;
    expect(failed).toBeTruthy();
  });
});
