import { describe, expect, it } from 'vitest';
import { parseErpCsv, type RawCsvRow } from '@/lib/erp-parser';

function makeRow(over: Partial<RawCsvRow>): RawCsvRow {
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

describe('parseErpCsv — option parsing PL', () => {
  it('extracts canonical fields from a full Polish option string', async () => {
    const rows = [makeRow({
      'Numer': 'Shoper999-1',
      'Data zamówienia': '2025-07-15 14:30:00',
      'Pozycje zamówienia/Produkt/Nazwa': 'Łóżko tapicerowane Comfy',
      'Pozycje zamówienia/Ilość': '1',
      'Pozycje zamówienia/Opcja': 'Powierzchnia spania: 90cm x 200cm; Materace: materacpiankowylateks; Wysokość wezgłowia: 70 cm; Wybór pojemnika na pościel i stelaża: stelaz metalowy z pojemnikiem (+399zł); Strona łóżka: Prawa; Tkanina: Loop 03; Rodzaj wezgłowia: tapicerowane; Dobór poduszek: 2 sztuki; Dobór kołdry: zimowa',
      'Suma': '2499.00',
    })];
    const r = await parseErpCsv(rows);
    expect(r.items.length).toBe(1);
    const it = r.items[0];
    expect(it.bed_size).toBe('90cm x 200cm');
    expect(it.mattress_type).toBe('materacpiankowylateks');
    expect(it.headboard_height).toBe('70 cm');
    expect(it.storage_type).toContain('stelaz metalowy');
    expect(it.bed_side).toBe('Prawa');
    expect(it.fabric).toBe('Loop 03');
    expect(it.fabric_collection).toBe('Loop');
    expect(it.headboard_type).toBe('tapicerowane');
    expect(it.pillows_choice).toBe('2 sztuki');
    expect(it.duvet_choice).toBe('zimowa');
    expect(it.options_language).toBe('pl');
  });
});

describe('parseErpCsv — option parsing DE', () => {
  it('extracts canonical fields from a full German option string', async () => {
    const rows = [makeRow({
      'Numer': 'Shoper888-2',
      'Data zamówienia': '2025-07-15 14:30:00',
      'Pozycje zamówienia/Produkt/Nazwa': 'Polsterbett Elegance',
      'Pozycje zamówienia/Ilość': '1',
      'Pozycje zamówienia/Opcja': 'Liegefläche: 140cm x 200cm; Matratzen: ohnematratze; Kopfteilhöhe: 110 cm; Auswahl eines Bettkastens und Bettenrostes: ohne bettkasten; Stoff: Loop 03; Kopfteilart: nicht gepolstert',
      'Suma': '699.00',
    })];
    const r = await parseErpCsv(rows);
    expect(r.items.length).toBe(1);
    const it = r.items[0];
    expect(it.bed_size).toBe('140cm x 200cm');
    expect(it.mattress_type).toBe('ohnematratze');
    expect(it.headboard_height).toBe('110 cm');
    expect(it.storage_type).toContain('ohne bettkasten');
    expect(it.fabric).toBe('Loop 03');
    expect(it.headboard_type).toBe('nicht gepolstert');
    expect(it.options_language).toBe('de');
  });
});

describe('parseErpCsv — option parsing Mitto style', () => {
  it('keeps only collection value before "|" in fabric-like payloads', async () => {
    const rows = [makeRow({
      'Numer': 'Shopify5001-1',
      'Data zamówienia': '2025-07-15 14:30:00',
      'Pozycje zamówienia/Produkt/Nazwa': 'Narożnik',
      'Pozycje zamówienia/Ilość': '1',
      'Pozycje zamówienia/Opcja': 'Kolekcja tkanin: Lincoln | Kolor: Beżowy',
    })];
    const r = await parseErpCsv(rows);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].fabric).toBe('Lincoln');
    expect(r.items[0].fabric_collection).toBe('Lincoln');
  });
});
