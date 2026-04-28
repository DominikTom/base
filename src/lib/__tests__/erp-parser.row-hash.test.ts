import { describe, expect, it } from 'vitest';
import { computeOrderRowHash } from '@/lib/erp-parser';
import type { FactOrder } from '@/types/database';

function baseOrder(): Omit<FactOrder, 'row_hash'> {
  return {
    order_id: 'Shoper1234-1',
    order_date: '2025-07-15T12:30:00.000Z',
    expected_date: null,
    fulfillment_date: null,
    source_platform: 'shoper',
    source_shop: 'mybed.pl',
    currency: 'PLN',
    total_gross: 2499.0,
    shipping_cost: 0,
    exchange_rate: 1,
    total_gross_pln: 2499.0,
    shipping_cost_pln: 0,
    is_paid: true,
    coupon_code: null,
    status: 'zamówienie',
    customer_name: 'Jan Kowalski',
    customer_email_hash: 'abc',
    delivery_city: 'Warszawa',
    delivery_zip: '02-784',
    delivery_method: 'InPost',
    supplier: 'Comfy',
    production_batch: null,
    sales_person: null,
    marketplace_tag: null,
    operational_tags: ['MONTAŻ'],
    invoice_production: null,
    invoice_mattress: null,
    invoice_transport: null,
    notes: null,
  };
}

describe('computeOrderRowHash', () => {
  it('is deterministic for identical input', async () => {
    const a = await computeOrderRowHash(baseOrder());
    const b = await computeOrderRowHash(baseOrder());
    expect(a).toBe(b);
    expect(a.length).toBe(32);
  });

  it('changes when a business field changes', async () => {
    const before = await computeOrderRowHash(baseOrder());
    const changed = { ...baseOrder(), total_gross: 2599.0, total_gross_pln: 2599.0 };
    const after = await computeOrderRowHash(changed);
    expect(before).not.toBe(after);
  });

  it('changes when status changes (anulowanie detection)', async () => {
    const before = await computeOrderRowHash(baseOrder());
    const after = await computeOrderRowHash({ ...baseOrder(), status: 'anulowane' });
    expect(before).not.toBe(after);
  });

  it('is order-independent for operational_tags', async () => {
    const a = await computeOrderRowHash({ ...baseOrder(), operational_tags: ['A', 'B'] });
    const b = await computeOrderRowHash({ ...baseOrder(), operational_tags: ['B', 'A'] });
    expect(a).toBe(b);
  });
});
