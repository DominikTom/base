import { SHOP_TO_META_ACCOUNT } from '@/lib/marketing-constants';

// Sklepy, które zna serwer MCP — te same nazwy co w Agents MyBed (marka = sklep).
// mojepostel.cz nie ma jeszcze konta reklamowego Meta: zapytania o ten sklep
// zwracają pusty wynik z ostrzeżeniem zamiast błędu.
export const MCP_SHOPS = ['mybed.pl', 'mybed.de', 'mojepostel.cz', 'mittohome.pl', 'nomosleep.pl'] as const;
export type McpShop = (typeof MCP_SHOPS)[number];

export function isMcpShop(value: string): value is McpShop {
  return (MCP_SHOPS as readonly string[]).includes(value);
}

/** Konto Meta → sklep (dla kont spoza mapowania zwraca account_id). */
export function shopForAccount(accountId: string): string {
  for (const [shop, account] of Object.entries(SHOP_TO_META_ACCOUNT)) {
    if (account === accountId) return shop;
  }
  return accountId;
}

export interface ShopScope {
  shops: McpShop[];
  accountIds: string[];
  warnings: string[];
}

/**
 * Zakres zapytania: sklepy dozwolone dla użytkownika ∩ sklep z parametru.
 * Rzuca błąd, gdy użytkownik prosi o sklep spoza swojego zakresu — narzędzie
 * zwraca wtedy komunikat zamiast cicho pustego wyniku.
 */
export function resolveShopScope(requested: string | undefined | null, allowed: readonly McpShop[]): ShopScope {
  if (allowed.length === 0) {
    throw new Error('Twoje konto nie ma przypisanych sklepów — poproś admina o dostęp (dash: Dostęp MCP).');
  }
  let shops: McpShop[];
  if (requested) {
    if (!isMcpShop(requested)) {
      throw new Error(`Nieznany sklep „${requested}”. Dozwolone: ${MCP_SHOPS.join(', ')}.`);
    }
    if (!allowed.includes(requested)) {
      throw new Error(`Brak dostępu do sklepu ${requested}. Twój zakres: ${allowed.join(', ') || 'brak'}.`);
    }
    shops = [requested];
  } else {
    shops = [...allowed];
  }

  const warnings: string[] = [];
  const accountIds: string[] = [];
  for (const shop of shops) {
    const account = SHOP_TO_META_ACCOUNT[shop];
    if (account) accountIds.push(account);
    else warnings.push(`${shop}: brak przypisanego konta reklamowego Meta — brak danych.`);
  }
  return { shops, accountIds, warnings };
}
