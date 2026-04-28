import { describe, expect, it } from 'vitest';
import { parseErpCsv, type RawCsvRow } from '@/lib/erp-parser';

function row(over: Partial<RawCsvRow>): RawCsvRow {
  return {
    'Numer': '',
    'Data zamówienia': '',
    'Przewidywana data': '',
    'Pozycje zamówienia/Produkt/Nazwa': '',
    'Pozycje zamówienia/Ilość': '1',
    'Pozycje zamówienia/Opcja': '',
    'Metoda dostawy': '',
    'Kod pocztowy': '',
    'Miasto': '',
    'Suma': '',
    'Koszt dostawy': '',
    'Uwagi': '',
    'Zapłacone': 'False',
    'Status': 'Zamówienie sprzedaży',
    'Tagi': '',
    'Data realizacji': '',
    'Kupon rabatowy': '',
    'Faktura produkcyjna': '',
    'Faktura materac': '',
    'Faktura transportowa': '',
    'Klient/Nazwa': '',
    'Klient/E-mail': '',
    'Klient/Telefon': '',
    'Adres dostawy/Ulica': '',
    ...over,
  };
}

describe('parseErpCsv — exploded rows grouping', () => {
  it('groups multiple line items + tag-only rows under one order', async () => {
    const rows = [
      // Order 1: header + 2 sub-items + 1 tag-only
      row({
        'Numer': 'Shoper1001-1',
        'Data zamówienia': '2025-07-15 10:00:00',
        'Pozycje zamówienia/Produkt/Nazwa': 'Łóżko Comfy',
        'Tagi': 'Comfy, MONTAŻ',
      }),
      row({ 'Pozycje zamówienia/Produkt/Nazwa': 'Materac' }),
      row({ 'Tagi': 'Reklamacja w toku' }),                       // tag-only
      row({ 'Pozycje zamówienia/Produkt/Nazwa': 'Wniesienie zamówienia' }),
      // Order 2: header + 1 sub-item
      row({
        'Numer': 'Shoper1002-2',
        'Data zamówienia': '2025-07-15 11:00:00',
        'Pozycje zamówienia/Produkt/Nazwa': 'Polsterbett',
        'Pozycje zamówienia/Opcja': 'Stoff: Loop 03',
        'Tagi': 'Profoam',
      }),
      // Order 3: header alone (one item only)
      row({
        'Numer': 'ZAM/00042',
        'Data zamówienia': '2025-07-15 12:00:00',
        'Pozycje zamówienia/Produkt/Nazwa': 'Voucher 1000',
      }),
    ];

    const r = await parseErpCsv(rows);
    expect(r.orders.length).toBe(3);
    expect(r.items.length).toBe(5); // 3 + 1 + 1

    const order1 = r.orders.find(o => o.order_id === 'Shoper1001-1')!;
    // Tags from header + tag-only row should both be present in operational_tags
    expect(order1.supplier).toBe('Comfy');
    expect(order1.operational_tags).toContain('MONTAŻ');
    expect(order1.operational_tags).toContain('Reklamacja w toku');

    const order2 = r.orders.find(o => o.order_id === 'Shoper1002-2')!;
    expect(order2.supplier).toBe('Profoam');
    expect(order2.source_shop).toBe('mybed.de');

    const order3 = r.orders.find(o => o.order_id === 'ZAM/00042')!;
    expect(order3.source_platform).toBe('manual');
    expect(order3.source_shop).toBe('showroom');

    expect(r.stats.tagOnlyRows).toBe(1);
    expect(r.stats.ordersCount).toBe(3);
  });
});

describe('parseErpCsv — Shoper without -1/-2 suffix', () => {
  it('classifies as shoper_unknown and emits a warning', async () => {
    const rows = [row({
      'Numer': 'Shoper123456',
      'Data zamówienia': '2025-07-15 10:00:00',
      'Pozycje zamówienia/Produkt/Nazwa': 'Łóżko',
    })];
    const r = await parseErpCsv(rows);
    expect(r.orders[0].source_shop).toBe('shoper_unknown');
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain('Shoper123456');
  });
});
