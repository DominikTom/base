-- ============================================================
-- Migration 008: AI assistant read-only SQL access
-- ============================================================
-- Cele:
--   1. Rola ai_readonly (NOLOGIN) — tylko SELECT na tabelach
--      analitycznych. Świadomie BEZ dostępu do: auth.*, user_profiles,
--      ai_conversations, ai_messages, kpi_definitions, raw_* (PII klientów),
--      etl_quarantine, reconciliation_log.
--   2. Funkcja ai_run_readonly_query() — SECURITY DEFINER należąca do
--      ai_readonly. Wykonuje zapytanie wygenerowane przez AI w transakcji
--      read-only, z limitem czasu i twardym LIMIT-em 1000 wierszy.
--      Wywoływana wyłącznie przez service_role (API /api/assistant/query).
--
-- UWAGA OPERACYJNA: tę migrację musi zastosować administrator bazy
-- (Supabase SQL editor lub `supabase db push`). Tworzy rolę i funkcję
-- SECURITY DEFINER — zmiany uprawnień, nie tylko schematu.
-- ============================================================

-- Rola o minimalnych uprawnieniach. NOLOGIN — nie da się na nią zalogować,
-- używana tylko jako właściciel funkcji SECURITY DEFINER poniżej.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_readonly') THEN
    CREATE ROLE ai_readonly NOLOGIN;
  END IF;
END $$;

-- Rola wykonująca migrację musi być członkiem ai_readonly, żeby móc
-- przepisać na nią właściciela funkcji (ALTER FUNCTION ... OWNER TO).
GRANT ai_readonly TO CURRENT_USER;

-- Widoczność schematu public, ale żadnych uprawnień do tabel poza listą.
GRANT USAGE ON SCHEMA public TO ai_readonly;

-- SELECT wyłącznie na jawnej liście tabel analitycznych.
-- (NIE GRANT ON ALL TABLES — lista jest celowo zamknięta.)
GRANT SELECT ON
  fact_orders,
  fact_order_items,
  fact_daily_revenue,
  fact_daily_adspend,
  fact_daily_traffic,
  fact_daily_ad_performance,
  dim_exchange_rates,
  dim_products,
  dim_fabrics,
  dim_creatives,
  etl_log
TO ai_readonly;

-- Belt-and-braces: odbierz jakiekolwiek prawa zapisu, gdyby coś było
-- odziedziczone z PUBLIC.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM ai_readonly;

-- ------------------------------------------------------------
-- Funkcja wykonująca zapytanie AI.
-- SECURITY DEFINER → kod działa z uprawnieniami WŁAŚCICIELA funkcji
-- (ai_readonly), a nie wywołującego (service_role). Dzięki temu AI nie
-- ma dostępu do tabel spoza GRANT-u powyżej, nawet jeśli service_role ma.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION ai_run_readonly_query(query_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Twarde zabezpieczenia na poziomie transakcji. transaction_read_only
  -- sprawia, że jakikolwiek zapis (INSERT/UPDATE/DELETE/DDL) zostanie
  -- odrzucony przez silnik bazy, niezależnie od treści zapytania.
  SET LOCAL transaction_read_only = on;
  SET LOCAL statement_timeout = '8s';
  SET LOCAL idle_in_transaction_session_timeout = '10s';

  -- Zapytanie AI trafia w pozycję PODZAPYTANIA — średnik nie pozwoli
  -- doklejić drugiej instrukcji (rozbije składnię), a wynik jest twardo
  -- ograniczony do 1000 wierszy.
  EXECUTE format(
    'SELECT jsonb_agg(row_to_json(sub)) FROM (SELECT * FROM (%s) ai_q LIMIT 1000) sub',
    query_text
  ) INTO result;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- Właścicielem funkcji jest rola o minimalnych uprawnieniach.
ALTER FUNCTION ai_run_readonly_query(text) OWNER TO ai_readonly;

-- Tylko API (service_role) może wywołać funkcję. Nie anon, nie authenticated.
REVOKE ALL ON FUNCTION ai_run_readonly_query(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_run_readonly_query(text) TO service_role;
