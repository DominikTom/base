/**
 * MyBed Group — ERP CSV Parser
 *
 * Parses IdeaERP CSV exports into structured order + order item records.
 * Handles multi-row orders, tag-only sub-rows, PL/DE option detection,
 * product categorization, and tag classification.
 */

import type { FactOrder, FactOrderItem } from '@/types/database';
import { getEurPlnRate } from '@/lib/currency';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KNOWN_SUPPLIERS = [
  'Comfy', 'Hekiert', 'Bedtime', 'Tobi One', 'Włodex', 'VONGAI', 'Panicz',
  'AG', 'Profoam', 'MOBLER', 'Mazur', 'Woodstol', 'Brewus', 'Panek', 'MZ',
  'Bruma', 'H24', 'Łabuda',
];

const KNOWN_MARKETPLACES = ['Allegro', 'Amazon', 'Kaufland DE'];

const KNOWN_SALES_PERSONS = [
  'Bartłomiej Poznań', 'Ola Wrocław', 'Sandra Nowak', 'Sebastian Warszawa',
  'Ramona Warszawa', 'Ola Katowice', 'Sandra Katowice', 'Bartek Poznań',
];

const DE_OPTION_KEYS = [
  'Liegefläche', 'Matratzen', 'Kopfteilhöhe', 'Stoff', 'Seite des Bettes',
  'Kopfteilart', 'Bettkasten', 'Auswahl eines Bettkastens',
  'Art der eingebauten Matratze', 'Topper-Matratzen', 'Öffnungsmethode',
  'Bettdeckengröße', 'Härte der eingebauten Matratze', 'Füßen',
];

const BATCH_PATTERN = /^[Tt][Bb]?\d+$/;

// ---------------------------------------------------------------------------
// Option key mapping (PL + DE → canonical field name)
// ---------------------------------------------------------------------------

interface OptionKeyMap {
  [key: string]: keyof ParsedOptions;
}

const OPTION_KEY_MAP: OptionKeyMap = {
  // PL keys
  'powierzchnia spania': 'bed_size',
  'materace': 'mattress_type',
  'tkanina': 'fabric',
  'wysokość wezgłowia': 'headboard_height',
  'wybór pojemnika na pościel i stelaża': 'storage_type',
  'rodzaj wezgłowia': 'headboard_type',
  'strona łóżka': 'bed_side',
  'sposób otwierania pojemnika na pościel': 'storage_opening',
  'sposób otwierania': 'storage_opening',
  'twardość materaca': 'mattress_hardness',
  'dobór poduszek': 'pillows_choice',
  'ilość poduszek 40 x 40': 'pillows_40x40',
  'ilość poduszek 50 x 60': 'pillows_50x60',
  'ilość poduszek 50 x 70': 'pillows_50x70',
  'ilość poduszek 70 x 80': 'pillows_70x80',
  'dobór kołdry': 'duvet_choice',
  'nogi': 'legs_type',
  'rodzaj wbudowanego materaca': 'built_in_mattress_type',
  'materace nawierzchniowe': 'topper_type',
  'rozmiar kołdry': 'duvet_size',
  'twardość wbudowanego materaca': 'built_in_mattress_hardness',
  'kolekcja tkanin': 'fabric',
  'funkcja spania': 'sleep_function',
  'kolor drewna': 'wood_color',

  // DE keys
  'liegefläche': 'bed_size',
  'matratzen': 'mattress_type',
  'stoff': 'fabric',
  'kopfteilhöhe': 'headboard_height',
  'auswahl eines bettkastens und bettenrostes': 'storage_type',
  'kopfteilart': 'headboard_type',
  'seite des bettes': 'bed_side',
  'art der eingebauten matratze': 'built_in_mattress_type',
  'topper-matratzen': 'topper_type',
  'öffnungsmethode': 'storage_opening',
  'bettdeckengröße': 'duvet_size',
  'härte der eingebauten matratze': 'built_in_mattress_hardness',
  'füßen': 'legs_type',
  'kolekce látek': 'fabric',
};

interface ParsedOptions {
  bed_size?: string;
  mattress_type?: string;
  fabric?: string;
  headboard_height?: string;
  storage_type?: string;
  headboard_type?: string;
  bed_side?: string;
  storage_opening?: string;
  mattress_hardness?: string;
  pillows_choice?: string;
  pillows_40x40?: string;
  pillows_50x60?: string;
  pillows_50x70?: string;
  pillows_70x80?: string;
  duvet_choice?: string;
  legs_type?: string;
  built_in_mattress_type?: string;
  topper_type?: string;
  duvet_size?: string;
  built_in_mattress_hardness?: string;
  sleep_function?: string;
  wood_color?: string;
}

// ---------------------------------------------------------------------------
// Product categorization
// ---------------------------------------------------------------------------

interface CategoryRule {
  category: string;
  item_type: string;
  match: (name: string) => boolean;
}

const CATEGORY_RULES: CategoryRule[] = [
  { category: 'wysyłka', item_type: 'shipping', match: n => /wysyłk|versand/i.test(n) },
  { category: 'usługa', item_type: 'service', match: n => /wniesienie|montaż|usługa|bestellung/i.test(n) },
  { category: 'dopłata', item_type: 'surcharge', match: n => /dopłata|zaliczka/i.test(n) },
  { category: 'próbki', item_type: 'product', match: n => /próbk|darmowe/i.test(n) },
  { category: 'łóżko', item_type: 'product', match: n => /łóżko|łożko|bett|boxspring/i.test(n) },
  { category: 'materac', item_type: 'product', match: n => /materac|matratze|topper/i.test(n) },
  { category: 'kołdra', item_type: 'product', match: n => /kołdr/i.test(n) },
  { category: 'poduszka', item_type: 'product', match: n => /poduszk/i.test(n) },
  { category: 'sofa', item_type: 'product', match: n => /sofa|narożnik/i.test(n) },
  { category: 'fotel', item_type: 'product', match: n => /fotel/i.test(n) },
  { category: 'pufa', item_type: 'product', match: n => /pufa/i.test(n) },
  { category: 'meble-dziecięce', item_type: 'product', match: n => /niko /i.test(n) },
  { category: 'meble', item_type: 'product', match: n => /stolik|komoda|szafka|konsola|regał|szafa/i.test(n) },
  { category: 'koc', item_type: 'product', match: n => /koc /i.test(n) },
  { category: 'dekoracje', item_type: 'product', match: n => /świec|dyfuzor/i.test(n) },
  { category: 'pielęgnacja', item_type: 'product', match: n => /^oa /i.test(n) },
  { category: 'zestaw', item_type: 'product', match: n => /zestaw/i.test(n) },
  { category: 'voucher', item_type: 'product', match: n => /karta|voucher/i.test(n) },
  { category: 'konfigurator', item_type: 'product', match: n => /konfigurator/i.test(n) },
  { category: 'SKU-kodowany', item_type: 'product', match: n => /^[A-Z]_/.test(n) || /^K[a-z]/.test(n) || /^L_/.test(n) },
];

function categorizeProduct(name: string): { category: string; item_type: string } {
  const trimmed = name.trim();
  for (const rule of CATEGORY_RULES) {
    if (rule.match(trimmed)) {
      return { category: rule.category, item_type: rule.item_type };
    }
  }
  return { category: 'inne', item_type: 'product' };
}

// ---------------------------------------------------------------------------
// Source detection
// ---------------------------------------------------------------------------

function detectSource(orderNumber: string, optionStr: string): { platform: string; shop: string } {
  const num = orderNumber.trim();

  if (num.startsWith('Shopify')) {
    return { platform: 'shopify', shop: 'mittohome.pl' };
  }
  if (num.startsWith('Amazon')) {
    return { platform: 'amazon', shop: 'amazon.de' };
  }
  if (num.startsWith('Allegro')) {
    return { platform: 'allegro', shop: 'allegro.pl' };
  }
  if (num.startsWith('Kaufland')) {
    return { platform: 'kaufland', shop: 'kaufland.de' };
  }
  if (num.startsWith('ZAM/')) {
    return { platform: 'manual', shop: 'showroom' };
  }

  // Shoper or numeric — check language of options to distinguish PL vs DE
  const isDE = isGermanOptions(optionStr);
  if (num.startsWith('Shoper')) {
    return { platform: 'shoper', shop: isDE ? 'mybed.de' : 'mybed.pl' };
  }

  // 10-digit numeric
  if (/^\d{10}$/.test(num)) {
    return { platform: 'shoper', shop: isDE ? 'mybed.de' : 'mybed.pl' };
  }

  // Fallback
  return { platform: 'unknown', shop: 'unknown' };
}

function isGermanOptions(optionStr: string): boolean {
  if (!optionStr) return false;
  const lower = optionStr.toLowerCase();
  return DE_OPTION_KEYS.some(key => lower.includes(key.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Option parsing
// ---------------------------------------------------------------------------

function parseOptions(optionStr: string): { parsed: ParsedOptions; language: string | null } {
  if (!optionStr || !optionStr.trim()) {
    return { parsed: {}, language: null };
  }

  const parsed: ParsedOptions = {};
  const language = isGermanOptions(optionStr) ? 'de' : 'pl';

  // Split by semicolons
  const parts = optionStr.split(';').map(p => p.trim()).filter(Boolean);

  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue; // free-text without key:value — skip

    const key = part.substring(0, colonIdx).trim().toLowerCase();
    const value = part.substring(colonIdx + 1).trim();

    // Skip internal/technical keys
    if (key.startsWith('_') || key.includes('url') || key.includes('planner') || key.includes('service_for')) {
      continue;
    }

    const field = OPTION_KEY_MAP[key];
    if (field) {
      (parsed as Record<string, string>)[field] = value;
    }
  }

  return { parsed, language };
}

function extractFabricCollection(fabric: string | undefined): string | null {
  if (!fabric) return null;
  // "Wind 21" → "Wind", "Matt Velvet 06" → "Matt Velvet", "Dream Velvet 20237" → "Dream Velvet"
  const match = fabric.match(/^(.+?)\s+\d+/);
  return match ? match[1].trim() : fabric.trim();
}

function parseDecimal(value: string): number | null {
  const raw = (value || '').trim();
  if (!raw) return null;

  // ERP CSV often uses EU formatting:
  // - decimal comma: "1234,56"
  // - thousand separators: "1 234,56" or "1.234,56"
  // but we also want to tolerate mixed inputs.
  const sanitized = raw
    .replace(/\s+/g, '')
    .replace(/[^\d,.-]/g, '');

  if (!sanitized) return null;

  const hasComma = sanitized.includes(',');
  const hasDot = sanitized.includes('.');
  let normalized = sanitized;

  if (hasComma && hasDot) {
    // Last separator wins as decimal, the other is thousands.
    const lastComma = sanitized.lastIndexOf(',');
    const lastDot = sanitized.lastIndexOf('.');
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    normalized = sanitized.split(thousandSep).join('');
    if (decimalSep === ',') normalized = normalized.replace(',', '.');
  } else if (hasComma) {
    // Comma-only → treat last comma as decimal separator.
    const parts = sanitized.split(',');
    const decimal = parts.pop() || '';
    normalized = `${parts.join('')}.${decimal}`;
  } else if (hasDot) {
    // Dot-only with 3 trailing digits is usually a thousands separator in EU exports.
    const parts = sanitized.split('.');
    const singleDot = parts.length === 2;
    const trailing = parts[parts.length - 1] || '';
    const looksLikeThousands = singleDot && trailing.length === 3;
    normalized = looksLikeThousands ? parts.join('') : sanitized;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

// ---------------------------------------------------------------------------
// Tag classification
// ---------------------------------------------------------------------------

interface ClassifiedTags {
  supplier: string | null;
  production_batch: string | null;
  sales_person: string | null;
  marketplace_tag: string | null;
  operational_tags: string[];
}

function classifyTags(tags: string[]): ClassifiedTags {
  const result: ClassifiedTags = {
    supplier: null,
    production_batch: null,
    sales_person: null,
    marketplace_tag: null,
    operational_tags: [],
  };

  for (const tag of tags) {
    const t = tag.trim();
    if (!t || t === 'False') continue; // Bug in ERP — ignore "False"

    if (BATCH_PATTERN.test(t)) {
      result.production_batch = result.production_batch || t;
      continue;
    }

    const supplierMatch = KNOWN_SUPPLIERS.find(
      s => s.toLowerCase() === t.toLowerCase()
    );
    if (supplierMatch) {
      result.supplier = result.supplier || supplierMatch;
      continue;
    }

    const marketplaceMatch = KNOWN_MARKETPLACES.find(
      m => m.toLowerCase() === t.toLowerCase()
    );
    if (marketplaceMatch) {
      result.marketplace_tag = result.marketplace_tag || marketplaceMatch;
      continue;
    }

    const salesMatch = KNOWN_SALES_PERSONS.find(
      sp => t.toLowerCase().includes(sp.toLowerCase().split(' ')[0])
        && (sp.toLowerCase().split(' ').length < 2 || t.toLowerCase().includes(sp.toLowerCase().split(' ')[1]))
    );
    if (salesMatch) {
      result.sales_person = result.sales_person || t;
      continue;
    }

    result.operational_tags.push(t);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Status normalization
// ---------------------------------------------------------------------------

function normalizeStatus(raw: string): string {
  const s = (raw || '').trim().toLowerCase();
  if (s.includes('zrealizowane')) return 'zrealizowane';
  if (s.includes('anulowano')) return 'anulowane';
  if (s.includes('oferta wysłana')) return 'oferta';
  if (s.includes('oferta')) return 'oferta';
  if (s.includes('zamówienie')) return 'zamówienie';
  return raw.trim() || 'unknown';
}

// ---------------------------------------------------------------------------
// SHA-256 hash (for email privacy)
// ---------------------------------------------------------------------------

async function hashEmail(email: string): Promise<string | null> {
  if (!email || !email.trim()) return null;
  // Use Web Crypto API (available in Node 18+ and all modern browsers)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(email.trim().toLowerCase());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback: just return a simple hash
  return email.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// CSV row interface (raw from PapaParse)
// ---------------------------------------------------------------------------

export interface RawCsvRow {
  'Numer': string;
  'Data zamówienia': string;
  'Przewidywana data': string;
  'Pozycje zamówienia/Produkt/Nazwa': string;
  'Pozycje zamówienia/Ilość': string;
  'Pozycje zamówienia/Opcja': string;
  'Metoda dostawy': string;
  'Kod pocztowy': string;
  'Miasto': string;
  'Suma': string;
  'Koszt dostawy': string;
  'Uwagi': string;
  'Zapłacone': string;
  'Status': string;
  'Tagi': string;
  'Data realizacji': string;
  'Kupon rabatowy': string;
  'Faktura produkcyjna': string;
  'Faktura materac': string;
  'Faktura transportowa': string;
  'Klient/Nazwa': string;
  'Klient/E-mail': string;
  'Klient/Telefon': string;
  'Adres dostawy/Ulica': string;
}

// ---------------------------------------------------------------------------
// Intermediate structures during parsing
// ---------------------------------------------------------------------------

interface OrderGroup {
  header: RawCsvRow;
  items: RawCsvRow[];       // product/service sub-rows
  tagOnlyRows: RawCsvRow[]; // sub-rows with only tags
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

export interface ParseResult {
  orders: FactOrder[];
  items: FactOrderItem[];
  stats: {
    totalRows: number;
    ordersCount: number;
    itemsCount: number;
    tagOnlyRows: number;
    skippedRows: number;
    byShop: Record<string, number>;
    byStatus: Record<string, number>;
    dateRange: { min: string; max: string };
  };
}

export async function parseErpCsv(rows: RawCsvRow[]): Promise<ParseResult> {
  // Step 1: Group rows into orders
  const groups: OrderGroup[] = [];
  let current: OrderGroup | null = null;
  let skippedRows = 0;
  let tagOnlyCount = 0;

  for (const row of rows) {
    const numer = (row['Numer'] || '').trim();
    const produktNazwa = (row['Pozycje zamówienia/Produkt/Nazwa'] || '').trim();
    const tagi = (row['Tagi'] || '').trim();

    if (numer) {
      // New order header
      current = { header: row, items: [], tagOnlyRows: [] };
      groups.push(current);

      // If the header row also has a product, it's the first item
      if (produktNazwa) {
        current.items.push(row);
      }
    } else if (current) {
      // Sub-row of current order
      if (produktNazwa) {
        // Product/service line
        current.items.push(row);
      } else if (tagi && tagi !== 'False') {
        // Tag-only row
        current.tagOnlyRows.push(row);
        tagOnlyCount++;
      } else {
        skippedRows++;
      }
    } else {
      skippedRows++;
    }
  }

  // Step 2: Convert groups into FactOrder + FactOrderItem
  const orders: FactOrder[] = [];
  const items: FactOrderItem[] = [];
  const byShop: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let minDate = '9999-12-31';
  let maxDate = '0000-01-01';

  for (const group of groups) {
    const h = group.header;
    const orderId = (h['Numer'] || '').trim();
    if (!orderId) continue;

    // Collect all options from all items for source detection
    const allOptions = group.items.map(i => (i['Pozycje zamówienia/Opcja'] || '')).join(' ');
    const { platform, shop } = detectSource(orderId, allOptions);

    // Currency
    const currency = ['mybed.de', 'amazon.de', 'kaufland.de'].includes(shop) ? 'EUR' : 'PLN';

    // Date (needed for exchange rate lookup)
    const orderDateStr = (h['Data zamówienia'] || '').trim();
    const orderDate = orderDateStr || new Date().toISOString();

    // Parse total
    const sumaStr = (h['Suma'] || '').trim();
    const totalGross = parseDecimal(sumaStr);
    const shippingStr = (h['Koszt dostawy'] || '').trim();
    const shippingCost = parseDecimal(shippingStr);

    const exchangeRate = currency === 'EUR' ? await getEurPlnRate(orderDate.substring(0, 10)) : 1;
    const totalGrossPln = currency === 'PLN' ? totalGross : (totalGross != null ? totalGross * exchangeRate : null);
    const shippingCostPln = currency === 'PLN' ? shippingCost : (shippingCost != null ? shippingCost * exchangeRate : null);

    // Status
    const status = normalizeStatus(h['Status'] || '');

    // Collect ALL tags: from header + from tag-only sub-rows
    const allTags: string[] = [];
    const headerTag = (h['Tagi'] || '').trim();
    if (headerTag && headerTag !== 'False') {
      allTags.push(...headerTag.split(',').map(t => t.trim()).filter(Boolean));
    }
    for (const tagRow of group.tagOnlyRows) {
      const t = (tagRow['Tagi'] || '').trim();
      if (t && t !== 'False') {
        allTags.push(...t.split(',').map(s => s.trim()).filter(Boolean));
      }
    }

    const classified = classifyTags(allTags);

    // Hash email
    const emailHash = await hashEmail(h['Klient/E-mail'] || '');

    // Date tracking
    const dateOnly = orderDate.substring(0, 10);
    if (dateOnly < minDate) minDate = dateOnly;
    if (dateOnly > maxDate) maxDate = dateOnly;

    // Build order record
    const order: FactOrder = {
      order_id: orderId,
      order_date: orderDate,
      expected_date: (h['Przewidywana data'] || '').trim() || null,
      fulfillment_date: (h['Data realizacji'] || '').trim() || null,
      source_platform: platform,
      source_shop: shop,
      currency,
      total_gross: totalGross,
      shipping_cost: shippingCost,
      exchange_rate: exchangeRate,
      total_gross_pln: totalGrossPln,
      shipping_cost_pln: shippingCostPln,
      is_paid: (h['Zapłacone'] || '').trim().toLowerCase() === 'true',
      coupon_code: (h['Kupon rabatowy'] || '').trim() || null,
      status,
      customer_name: (h['Klient/Nazwa'] || '').trim() || null,
      customer_email_hash: emailHash,
      delivery_city: (h['Miasto'] || '').trim() || null,
      delivery_zip: (h['Kod pocztowy'] || '').trim() || null,
      delivery_method: (h['Metoda dostawy'] || '').trim() || null,
      supplier: classified.supplier,
      production_batch: classified.production_batch,
      sales_person: classified.sales_person,
      marketplace_tag: classified.marketplace_tag,
      operational_tags: classified.operational_tags,
      invoice_production: (h['Faktura produkcyjna'] || '').trim() || null,
      invoice_mattress: (h['Faktura materac'] || '').trim() || null,
      invoice_transport: (h['Faktura transportowa'] || '').trim() || null,
      notes: (h['Uwagi'] || '').trim() || null,
    };

    orders.push(order);

    // Stats
    byShop[shop] = (byShop[shop] || 0) + 1;
    byStatus[status] = (byStatus[status] || 0) + 1;

    // Step 3: Parse items
    let lineNumber = 0;
    for (const itemRow of group.items) {
      const productName = (itemRow['Pozycje zamówienia/Produkt/Nazwa'] || '').trim();
      if (!productName) continue;

      lineNumber++;
      const { category, item_type } = categorizeProduct(productName);
      const quantityStr = (itemRow['Pozycje zamówienia/Ilość'] || '1').trim();
      const quantity = parseDecimal(quantityStr) || 1;

      const optionStr = (itemRow['Pozycje zamówienia/Opcja'] || '').trim();
      const { parsed, language } = parseOptions(optionStr);

      const fabricCollection = extractFabricCollection(parsed.fabric);

      const item: FactOrderItem = {
        order_id: orderId,
        line_number: lineNumber,
        product_name: productName,
        product_category: category,
        quantity,
        item_type,
        bed_size: parsed.bed_size || null,
        mattress_type: parsed.mattress_type || null,
        fabric: parsed.fabric || null,
        fabric_collection: fabricCollection,
        headboard_height: parsed.headboard_height || null,
        storage_type: parsed.storage_type || null,
        headboard_type: parsed.headboard_type || null,
        bed_side: parsed.bed_side || null,
        storage_opening: parsed.storage_opening || null,
        mattress_hardness: parsed.mattress_hardness || null,
        pillows_choice: parsed.pillows_choice || null,
        duvet_choice: parsed.duvet_choice || null,
        legs_type: parsed.legs_type || null,
        raw_options: optionStr || null,
        options_language: language,
      };

      items.push(item);
    }
  }

  return {
    orders,
    items,
    stats: {
      totalRows: rows.length,
      ordersCount: orders.length,
      itemsCount: items.length,
      tagOnlyRows: tagOnlyCount,
      skippedRows,
      byShop,
      byStatus,
      dateRange: { min: minDate, max: maxDate },
    },
  };
}
