-- ============================================================
-- Funkcja pokrycia danych ad-level (dla inteligentnego syncu)
-- ============================================================
-- Zwraca listę dat, dla których konto MA już wiersze w
-- fact_daily_ad_performance w zadanym zakresie. Endpoint planu syncu
-- odwraca to w listę brakujących zakresów — sync pobiera z Meta API
-- tylko dziury + ogon świeżości, zamiast nadpisywać wszystko.
-- (DISTINCT po stronie SQL, bo PostgREST nie umie select distinct,
-- a ciągnięcie date×ads wierszy przez API to tysiące rekordów.)

CREATE OR REPLACE FUNCTION ad_sync_dates_covered(
    p_account_id TEXT,
    p_from DATE,
    p_to DATE
)
RETURNS TABLE(covered_date DATE)
LANGUAGE sql
STABLE
AS $$
    SELECT DISTINCT date
    FROM fact_daily_ad_performance
    WHERE platform = 'meta'
      AND account_id = p_account_id
      AND date BETWEEN p_from AND p_to
    ORDER BY 1;
$$;
