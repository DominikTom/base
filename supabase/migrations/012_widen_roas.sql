-- ============================================================
-- Poszerzenie kolumny roas (fix 'numeric field overflow')
-- ============================================================
-- ROAS na dziennych wierszach ad-level potrafi być ekstremalny: groszowy
-- spend (0,01 zł) + duży przypisany zakup = ROAS w milionach. NUMERIC(10,4)
-- mieści max 999 999,9999 i sync mybed.pl wywalał się przy upsert.
-- Zastosowane na Supabase 2026-08-07 (przez MCP, przed commitem pliku).

ALTER TABLE fact_daily_ad_performance
    ALTER COLUMN roas TYPE NUMERIC(16, 4);
