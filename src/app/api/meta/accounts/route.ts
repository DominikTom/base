import { NextResponse } from 'next/server';
import { SHOP_TO_META_ACCOUNT, getAdAccountIds } from '@/lib/meta-ads';

// Lista skonfigurowanych Meta accounts z metadane sklepu (shop label).
// Używane przez SyncMenu żeby fire'ować per-account sync z client-side
// progress reportingiem.
export async function GET() {
  const configuredIds = new Set(getAdAccountIds());
  // Reverse lookup: account_id → shop_label
  const accountToShop: Record<string, string> = {};
  for (const [shop, accountId] of Object.entries(SHOP_TO_META_ACCOUNT)) {
    accountToShop[accountId] = shop;
  }

  const accounts = Array.from(configuredIds).map(accountId => ({
    accountId,
    shop: accountToShop[accountId] || accountId,
  }));

  return NextResponse.json({ accounts });
}
