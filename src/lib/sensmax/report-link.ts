import { createHmac } from 'crypto';
import type { Showroom } from './types';

function secret(): string {
  return process.env.REPORT_LINK_SECRET || process.env.ETL_CRON_SECRET || process.env.SENSMAX_CRON_SECRET || 'mybed-report-link';
}

export function signReportLink(showroom: Showroom, from: string, to: string): string {
  return createHmac('sha256', secret()).update(`${showroom}|${from}|${to}`).digest('hex').slice(0, 24);
}

export function verifyReportLink(showroom: string, from: string, to: string, sig: string | undefined): boolean {
  if (!sig) return false;
  return signReportLink(showroom as Showroom, from, to) === sig.toLowerCase();
}

export function buildReportPath(showroom: Showroom, from: string, to: string): string {
  const sig = signReportLink(showroom, from, to);
  return `/raport/showroom?showroom=${encodeURIComponent(showroom)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&sig=${sig}`;
}
