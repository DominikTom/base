import { describe, expect, it, vi } from 'vitest';

// mojepostel.cz (Shoper…-3): sklep w CZK, przeliczenie na PLN kursem NBP z dnia zamówienia.
vi.mock('@/lib/currency', () => ({
  getNbpRateToPln: vi.fn(async (code: string) => (code === 'CZK' ? 0.175 : 4.3)),
}));

const { parseErpCsv } = await import('@/lib/erp-parser');
type RawCsvRow = Parameters<typeof parseErpCsv>[0][number];

function row(over: Partial<RawCsvRow>): RawCsvRow {
  return {
    'Numer': '', 'Data zamówienia': '', 'Przewidywana data': '',
    'Pozycje zamówienia/Produkt/Nazwa': '', 'Pozycje zamówienia/Ilość': '1', 'Pozycje zamówienia/Opcja': '',
    'Metoda dostawy': '', 'Kod pocztowy': '', 'Miasto': '', 'Suma': '', 'Koszt dostawy': '', 'Uwagi': '',
    'Zapłacone': 'False', 'Status': 'Zamówienie sprzedaży', 'Tagi': '', 'Data realizacji': '',
    'Kupon rabatowy': '', 'Faktura produkcyjna': '', 'Faktura materac': '', 'Faktura transportowa': '',
    'Klient/Nazwa': '', 'Klient/E-mail': '', 'Klient/Telefon': '', 'Adres dostawy/Ulica': '',
    ...over,
  } as RawCsvRow;
}

describe('parseErpCsv — mojepostel.cz (Shoper -3)', () => {
  it('rozpoznaje sklep, walutę CZK i przelicza na PLN bez ostrzeżenia shoper_unknown', async () => {
    const r = await parseErpCsv([row({
      'Numer': 'Shoper49292-3',
      'Data zamówienia': '2026-11-05 12:00:00',
      'Suma': '20000',
      'Koszt dostawy': '1000',
      'Pozycje zamówienia/Produkt/Nazwa': 'Łóżko Lila',
    })]);
    const o = r.orders[0];
    expect(o.source_shop).toBe('mojepostel.cz');
    expect(o.currency).toBe('CZK');
    expect(o.exchange_rate).toBe(0.175);
    expect(o.total_gross_pln).toBeCloseTo(3500, 2);
    expect(o.shipping_cost_pln).toBeCloseTo(175, 2);
    expect(r.warnings).toHaveLength(0);
  });

  it('Shoper bez końcówki nadal jest shoper_unknown', async () => {
    const r = await parseErpCsv([row({ 'Numer': 'Shoper1', 'Data zamówienia': '2026-11-05 12:00:00', 'Pozycje zamówienia/Produkt/Nazwa': 'Łóżko' })]);
    expect(r.orders[0].source_shop).toBe('shoper_unknown');
  });
});
