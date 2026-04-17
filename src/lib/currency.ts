export const EUR_TO_PLN = 4.30;

export const EUR_SHOPS = ['mybed.de', 'amazon.de', 'kaufland.de'];

export function isEurShop(shop: string): boolean {
  return EUR_SHOPS.includes(shop);
}

export function getExchangeRate(currency: string): number {
  return currency === 'EUR' ? EUR_TO_PLN : 1;
}

export function convertToPln(amount: number, currency: string): number {
  return amount * getExchangeRate(currency);
}
