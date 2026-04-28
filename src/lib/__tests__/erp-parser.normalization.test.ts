import { describe, expect, it } from 'vitest';
import {
  normalizePhone,
  normalizePostalCode,
  stripFloatSuffix,
  warsawDateToUtcDateOnly,
  warsawNaiveToUtcIso,
} from '@/lib/erp-parser';

describe('stripFloatSuffix', () => {
  it('removes spreadsheet ".0" coercion artifact', () => {
    expect(stripFloatSuffix('56068.0')).toBe('56068');
    expect(stripFloatSuffix('1776730468.0')).toBe('1776730468');
    expect(stripFloatSuffix('123.00')).toBe('123');
  });
  it('preserves PL postal codes with hyphen', () => {
    expect(stripFloatSuffix('02-784')).toBe('02-784');
  });
  it('returns empty for null/undefined/empty', () => {
    expect(stripFloatSuffix(null)).toBe('');
    expect(stripFloatSuffix(undefined)).toBe('');
    expect(stripFloatSuffix('')).toBe('');
  });
  it('does not strip a real decimal', () => {
    expect(stripFloatSuffix('12.34')).toBe('12.34');
  });
});

describe('normalizePostalCode', () => {
  it('keeps PL hyphenated code', () => {
    expect(normalizePostalCode('02-784')).toBe('02-784');
  });
  it('strips ".0" from DE numeric code', () => {
    expect(normalizePostalCode('56068.0')).toBe('56068');
  });
  it('returns null on empty', () => {
    expect(normalizePostalCode('')).toBeNull();
    expect(normalizePostalCode(null)).toBeNull();
    expect(normalizePostalCode(undefined)).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('strips ".0" from spreadsheet float', () => {
    expect(normalizePhone('1776730468.0')).toBe('1776730468');
  });
  it('preserves international PL phone with spaces', () => {
    expect(normalizePhone('+48 600 123 456')).toBe('+48 600 123 456');
  });
});

describe('warsawNaiveToUtcIso', () => {
  it('converts CEST (summer) wall clock to UTC', () => {
    // 2025-07-15 14:30 Warsaw = 12:30 UTC
    expect(warsawNaiveToUtcIso('2025-07-15 14:30:00')).toBe('2025-07-15T12:30:00.000Z');
  });
  it('converts CET (winter) wall clock to UTC', () => {
    // 2025-01-15 14:30 Warsaw = 13:30 UTC
    expect(warsawNaiveToUtcIso('2025-01-15 14:30:00')).toBe('2025-01-15T13:30:00.000Z');
  });
  it('handles ISO T-separator', () => {
    expect(warsawNaiveToUtcIso('2025-07-15T14:30:00')).toBe('2025-07-15T12:30:00.000Z');
  });
  it('passes through explicit-tz strings', () => {
    expect(warsawNaiveToUtcIso('2025-07-15T14:30:00Z')).toBe('2025-07-15T14:30:00.000Z');
    expect(warsawNaiveToUtcIso('2025-07-15T14:30:00+02:00')).toBe('2025-07-15T12:30:00.000Z');
  });
  it('handles date-only as midnight Warsaw', () => {
    // 2025-07-15 00:00 Warsaw = 2025-07-14 22:00 UTC
    expect(warsawNaiveToUtcIso('2025-07-15')).toBe('2025-07-14T22:00:00.000Z');
  });
  it('returns null for empty / null', () => {
    expect(warsawNaiveToUtcIso(null)).toBeNull();
    expect(warsawNaiveToUtcIso(undefined)).toBeNull();
    expect(warsawNaiveToUtcIso('')).toBeNull();
  });
});

describe('warsawDateToUtcDateOnly', () => {
  it('returns YYYY-MM-DD anchored to UTC instant', () => {
    // 2025-07-15 00:00 Warsaw = 2025-07-14 22:00 UTC -> '2025-07-14'
    expect(warsawDateToUtcDateOnly('2025-07-15')).toBe('2025-07-14');
  });
});
