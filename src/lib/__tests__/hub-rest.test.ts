import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp/auth';

// REST Data Hub (/api/v1) bez bazy: autoryzacja i Supabase podmienione.

let ctx: McpAuthContext | null = null;
let rpcRows: Record<string, unknown[]> = {};
const audit: Array<Record<string, unknown>> = [];

vi.mock('@/lib/mcp/auth', () => ({ authenticateMcpRequest: vi.fn(async () => ctx) }));
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ insert: async (row: Record<string, unknown>) => { audit.push(row); return { error: null }; } }),
    rpc: (fn: string, params: Record<string, unknown>) => ({
      range: async () => ({ data: (rpcRows[`${fn}:${params.p_from}`] ?? []), error: null }),
    }),
  }),
}));

const { GET } = await import('@/app/api/v1/[...path]/route');
const { GET: OPENAPI } = await import('@/app/api/v1/openapi.json/route');
const { coerceArgs } = await import('@/lib/hub/rest');
const { z } = await import('zod');

function call(path: string, query = '') {
  const segments = path.split('/').filter(Boolean);
  const req = new Request(`http://localhost/api/v1/${path}${query ? `?${query}` : ''}`, {
    headers: { authorization: 'Bearer dmcp_test' },
  });
  return GET(req, { params: Promise.resolve({ path: segments }) });
}

beforeEach(() => {
  ctx = { tokenId: 't1', userId: 'u1', email: 'a@mybed.pl', role: 'viewer', allowedShops: ['mybed.pl'] };
  rpcRows = {};
  audit.length = 0;
});

describe('/api/v1', () => {
  it('bez tokenu: 401', async () => {
    ctx = null;
    const res = await call('sales/summary', 'date_from=2026-11-01&date_to=2026-11-02');
    expect(res.status).toBe(401);
  });

  it('indeks listuje zasoby i zakres sklepów', async () => {
    const body = await (await call('')).json();
    expect(body.your_shops).toEqual(['mybed.pl']);
    expect(body.endpoints.map((e: { path: string }) => e.path)).toContain('/api/v1/sales/summary');
    expect(body.endpoints).toHaveLength(12);
  });

  it('nieznany zasób: 404', async () => {
    expect((await call('nope')).status).toBe(404);
  });

  it('zły format daty: 400 z opisem pola', async () => {
    const res = await call('sales/summary', 'date_from=1.11.2026&date_to=2026-11-02');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/date_from/);
  });

  it('kanał spoza zakresu: 403 i wpis audytu z prefiksem rest:', async () => {
    const res = await call('sales/summary', 'date_from=2026-11-01&date_to=2026-11-02&channel=amazon.de');
    expect(res.status).toBe(403);
    expect(audit[0]).toMatchObject({ tool: 'rest:sales_summary' });
  });

  it('sales/summary liczy przychód, AOV i rozbicie per kanał (ZAM/ pominięte domyślnie)', async () => {
    rpcRows['hub_sales_daily:2026-11-01'] = [
      { day: '2026-11-01', source_shop: 'mybed.pl', currency: 'PLN', orders_total: 3, orders_billable: 2, orders_paid: 1, orders_offer: 1, orders_cancelled: 0, orders_other: 0, revenue_billable_pln: 3000, revenue_billable_orig: 3000, revenue_paid_pln: 1000, shipping_billable_pln: 100, revenue_offer_pln: 500, revenue_cancelled_pln: 0 },
      { day: '2026-11-02', source_shop: 'allegro.pl', currency: 'PLN', orders_total: 1, orders_billable: 1, orders_paid: 1, orders_offer: 0, orders_cancelled: 0, orders_other: 0, revenue_billable_pln: 600, revenue_billable_orig: 600, revenue_paid_pln: 600, shipping_billable_pln: 0, revenue_offer_pln: 0, revenue_cancelled_pln: 0 },
    ];
    rpcRows['hub_sales_daily:2026-10-30'] = [
      { day: '2026-10-30', source_shop: 'mybed.pl', currency: 'PLN', orders_total: 2, orders_billable: 2, orders_paid: 2, orders_offer: 0, orders_cancelled: 0, orders_other: 0, revenue_billable_pln: 1800, revenue_billable_orig: 1800, revenue_paid_pln: 1800, shipping_billable_pln: 0, revenue_offer_pln: 0, revenue_cancelled_pln: 0 },
    ];
    const res = await call('sales/summary', 'date_from=2026-11-01&date_to=2026-11-02&group_by=shop');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channels).toEqual(['mybed.pl', 'allegro.pl']);
    expect(body.totals).toMatchObject({
      orders: 3, revenue_pln: 3600, revenue_excl_shipping_pln: 3500, aov_pln: 1200,
      paid_orders: 2, payment_rate: 66.7, offers: { orders: 1, value_pln: 500 },
    });
    expect(body.totals.change.revenue_pct).toBe(100);
    expect(body.groups.map((g: { channel: string }) => g.channel)).toEqual(['mybed.pl', 'allegro.pl']);
  });

  it('POST: 405 (tylko odczyt)', async () => {
    const { POST } = await import('@/app/api/v1/[...path]/route');
    expect((await POST()).status).toBe(405);
  });
});

describe('koercja parametrów i OpenAPI', () => {
  it('zamienia query na typy ze schematu', () => {
    const shape = {
      n: z.number().int().optional(), b: z.boolean().default(false), list: z.array(z.string()).optional(), s: z.string(),
    };
    expect(coerceArgs(shape, { n: '20', b: 'true', list: 'a, b,,c', s: 'x' })).toEqual({ n: 20, b: true, list: ['a', 'b', 'c'], s: 'x' });
  });

  it('openapi.json opisuje wszystkie zasoby z parametrami', async () => {
    const spec = await OPENAPI(new Request('https://dash.mybed.pl/api/v1/openapi.json')).json();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.servers[0].url).toBe('https://dash.mybed.pl/api/v1');
    expect(Object.keys(spec.paths)).toHaveLength(12);
    const sales = spec.paths['/sales/summary'].get;
    const dateFrom = sales.parameters.find((p: { name: string }) => p.name === 'date_from');
    expect(dateFrom).toMatchObject({ in: 'query', required: true });
    const detail = spec.paths['/creatives/{creative_id}'].get;
    expect(detail.parameters.find((p: { name: string }) => p.name === 'creative_id')).toMatchObject({ in: 'path', required: true });
  });
});
