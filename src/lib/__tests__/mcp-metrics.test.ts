import { describe, expect, it } from 'vitest';
import {
  addRow, compareBy, emptyTotals, fatigueVerdict, finalize, groupRows, keyFor, NO_CREATIVE_KEY,
  pct, previousRange, type AdRow,
} from '@/lib/mcp/metrics';
import { resolveShopScope } from '@/lib/mcp/shops';
import { allowedShopsForProfile, bearerFromRequest, generateToken, hashToken } from '@/lib/mcp/auth';

function row(over: Partial<AdRow> = {}): AdRow {
  return {
    date: '2026-11-10', account_id: 'act_1681802382204753',
    campaign_id: 'c1', campaign_name: 'Kampania', adset_id: 's1', adset_name: 'Zestaw',
    ad_id: 'a1', ad_name: 'Reklama', creative_id: 'cr1',
    impressions: 1000, reach: 400, clicks: 20, spend: 100,
    conversions: 3,
    conversions_1d_click: 1, conversions_7d_click: 2, conversions_1d_view: 1,
    conversion_value_1d_click: 300, conversion_value_7d_click: 500, conversion_value_1d_view: 150,
    video_play_3s: 300, video_p25_watched: 150, video_p50_watched: 90, video_p75_watched: 60,
    video_p95_watched: 40, video_p100_watched: 30, thruplays: 75,
    ...over,
  };
}

describe('finalize', () => {
  it('liczy metryki pochodne dla wybranego okna atrybucji', () => {
    const t = emptyTotals();
    addRow(t, row(), '7d_click');
    addRow(t, row({ date: '2026-11-11' }), '7d_click');
    const m = finalize(t);
    expect(m.spend).toBe(200);
    expect(m.ctr).toBe(2);              // 40 / 2000 × 100
    expect(m.cpc).toBe(5);              // 200 / 40
    expect(m.cpm).toBe(100);            // 200 / 2000 × 1000
    expect(m.conversions).toBe(4);
    expect(m.conversion_value).toBe(1000);
    expect(m.roas).toBe(5);
    expect(m.cpa).toBe(50);
    expect(m.hook_rate).toBe(30);       // 600 / 2000 × 100
    expect(m.hold_rate).toBe(25);       // 150 / 600 × 100
    expect(m.video_curve).toEqual({ p25: 50, p50: 30, p75: 20, p95: 13.3, p100: 10 });
    expect(m.frequency).toBe(2.5);      // 2000 / 800
    expect(m.days_active).toBe(2);
  });

  it('1d_view bierze inne kolumny niż 7d_click', () => {
    const t = emptyTotals();
    addRow(t, row(), '1d_view');
    expect(finalize(t).roas).toBe(1.5);
    expect(t.defaultConversions).toBe(3);
  });

  it('bez wideo i bez kliknięć zwraca null zamiast dzielenia przez zero', () => {
    const t = emptyTotals();
    addRow(t, row({ video_play_3s: 0, clicks: 0, conversions_7d_click: 0 }), '7d_click');
    const m = finalize(t);
    expect(m.hook_rate).toBeNull();
    expect(m.video_curve).toBeNull();
    expect(m.cpc).toBeNull();
    expect(m.cpa).toBeNull();
  });

  it('dzień bez wydatku i wyświetleń nie liczy się jako aktywny', () => {
    const t = emptyTotals();
    addRow(t, row({ spend: 0, impressions: 0 }), '7d_click');
    expect(finalize(t).days_active).toBe(0);
  });
});

describe('groupRows / sortowanie', () => {
  it('grupuje po poziomie i trzyma najnowsze nazwy', () => {
    const rows = [
      row({ date: '2026-11-10', campaign_name: 'Stara nazwa' }),
      row({ date: '2026-11-12', campaign_name: 'Nowa nazwa', ad_id: 'a2' }),
    ];
    const g = groupRows(rows, 'campaign', '7d_click').get('c1')!;
    expect(g.sample.campaign_name).toBe('Nowa nazwa');
    expect(g.adIds.size).toBe(2);
  });

  it('wiersze bez creative_id trafiają do osobnej grupy', () => {
    expect(keyFor(row({ creative_id: null }), 'creative')).toBe(NO_CREATIVE_KEY);
  });

  it('CPA sortuje rosnąco, ROAS malejąco, puste na końcu', () => {
    const mk = (roas: number | null, cpa: number | null) => ({ ...finalize(emptyTotals()), roas, cpa });
    const list = [mk(1, 80), mk(null, null), mk(3, 20)];
    expect([...list].sort(compareBy('roas')).map(m => m.roas)).toEqual([3, 1, null]);
    expect([...list].sort(compareBy('cpa')).map(m => m.cpa)).toEqual([20, 80, null]);
  });
});

describe('fatigueVerdict', () => {
  const base = finalize(emptyTotals());
  it('frequency > 3 i spadek CTR > 20%', () => {
    const v = fatigueVerdict({ ...base, frequency: 3.4, ctr: 0.7, cpa: 50, spend: 600 }, { ...base, ctr: 1, cpa: 50 });
    expect(v.fatigued).toBe(true);
    expect(v.ctr_change_pct).toBe(-30);
  });
  it('sam spadek CTR przy niskiej frequency to nie zmęczenie', () => {
    expect(fatigueVerdict({ ...base, frequency: 1.5, ctr: 0.5, cpa: 50 }, { ...base, ctr: 1, cpa: 50 }).fatigued).toBe(false);
  });
  it('wzrost CPA > 30%', () => {
    const v = fatigueVerdict({ ...base, cpa: 140, ctr: 1 }, { ...base, cpa: 100, ctr: 1 });
    expect(v.fatigued).toBe(true);
    expect(v.cpa_change_pct).toBe(40);
  });
  it('brak konwersji w bieżącym oknie po konwersjach w poprzednim', () => {
    const v = fatigueVerdict({ ...base, spend: 700, conversions: 0, cpa: null }, { ...base, conversions: 5, cpa: 100 });
    expect(v.fatigued).toBe(true);
  });
});

describe('okresy', () => {
  it('poprzedni okres tej samej długości', () => {
    expect(previousRange('2026-11-01', '2026-11-30')).toEqual({ from: '2026-10-02', to: '2026-10-31' });
    expect(previousRange('2026-11-12', '2026-11-18')).toEqual({ from: '2026-11-05', to: '2026-11-11' });
  });
  it('pct', () => {
    expect(pct(120, 100)).toBe(20);
    expect(pct(1, 0)).toBeNull();
    expect(pct(null, 1)).toBeNull();
  });
});

describe('zakres sklepów', () => {
  const all = allowedShopsForProfile('viewer', null);
  it('viewer bez ograniczeń widzi wszystkie sklepy, admin zawsze wszystkie', () => {
    expect(all).toHaveLength(5);
    expect(allowedShopsForProfile('admin', ['mybed.pl'])).toHaveLength(5);
    expect(allowedShopsForProfile('viewer', ['mybed.de', 'nieznany'])).toEqual(['mybed.de']);
  });
  it('odmawia sklepu spoza zakresu', () => {
    expect(() => resolveShopScope('mybed.pl', ['mybed.de'])).toThrow(/Brak dostępu/);
    expect(() => resolveShopScope('allegro.pl', all)).toThrow(/Nieznany sklep/);
  });
  it('mojepostel.cz nie ma konta Meta — ostrzeżenie zamiast błędu', () => {
    const s = resolveShopScope('mojepostel.cz', all);
    expect(s.accountIds).toEqual([]);
    expect(s.warnings[0]).toMatch(/mojepostel\.cz/);
  });
  it('bez parametru shop — konta wszystkich dozwolonych sklepów', () => {
    expect(resolveShopScope(undefined, all).accountIds).toHaveLength(4);
  });
});

describe('tokeny', () => {
  it('generuje token z prefiksem i stabilnym hashem', () => {
    const { token, hash, displayPrefix } = generateToken();
    expect(token.startsWith('dmcp_')).toBe(true);
    expect(token.length).toBeGreaterThan(40);
    expect(hash).toBe(hashToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.startsWith(displayPrefix)).toBe(true);
  });
  it('czyta tylko nagłówek Bearer z tokenem dmcp_', () => {
    const req = (h?: string) => new Request('https://x/api/mcp', { headers: h ? { authorization: h } : {} });
    expect(bearerFromRequest(req('Bearer dmcp_abc'))).toBe('dmcp_abc');
    expect(bearerFromRequest(req('Bearer cron-secret'))).toBeNull();
    expect(bearerFromRequest(req())).toBeNull();
  });
});
