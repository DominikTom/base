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
--      EXECUTE ma wyłącznie service_role (API /api/assistant/chat).
--
-- Uwagi do środowiska Supabase (wynikają z faktycznego wdrożenia):
--   - `GRANT ai_readonly TO CURRENT_USER` z domyślnym INHERIT ubija
--     połączenie (ochrona Supabase przed eskalacją uprawnień roli postgres).
--     Dlatego używamy `WITH INHERIT FALSE, SET TRUE` — to wystarcza do
--     przepisania właściciela funkcji, bez dziedziczenia uprawnień.
--   - Zmiana właściciela na ai_readonly wymaga, by ai_readonly miała
--     chwilowo CREATE na schemacie public (Postgres sprawdza to dla
--     nowego właściciela). Nadajemy i od razu odbieramy.
--   - Domyślne przywileje Supabase nadają EXECUTE na nowych funkcjach
--     rolom anon/authenticated. REVOKE musi wykonać WŁAŚCICIEL funkcji
--     (ai_readonly), inaczej jest cichym no-opem.
-- ============================================================

-- 1. Rola o minimalnych uprawnieniach (NOLOGIN — brak logowania).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_readonly') THEN
    CREATE ROLE ai_readonly NOLOGIN;
  END IF;
END $$;

-- 2. Rola migracji musi móc SET ROLE ai_readonly (do ALTER ... OWNER).
--    INHERIT FALSE — bez tego Supabase zrywa połączenie.
GRANT ai_readonly TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;

-- 3. Uprawnienia odczytu — jawna, zamknięta lista tabel analitycznych.
GRANT USAGE ON SCHEMA public TO ai_readonly;
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

-- 4. Funkcja wykonująca zapytanie AI. SECURITY DEFINER → kod działa z
--    uprawnieniami WŁAŚCICIELA (ai_readonly), nie wywołującego.
CREATE OR REPLACE FUNCTION ai_run_readonly_query(query_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Twarde zabezpieczenia na poziomie transakcji.
  SET LOCAL transaction_read_only = on;
  SET LOCAL statement_timeout = '8s';
  SET LOCAL idle_in_transaction_session_timeout = '10s';

  -- Zapytanie AI trafia w pozycję PODZAPYTANIA — średnik nie pozwoli
  -- doklejić drugiej instrukcji, wynik twardo ograniczony do 1000 wierszy.
  EXECUTE format(
    'SELECT jsonb_agg(row_to_json(sub)) FROM (SELECT * FROM (%s) ai_q LIMIT 1000) sub',
    query_text
  ) INTO result;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- 5. Właścicielem funkcji ma być rola o minimalnych uprawnieniach.
--    Nowy właściciel potrzebuje chwilowo CREATE na schemacie public.
GRANT CREATE ON SCHEMA public TO ai_readonly;
ALTER FUNCTION ai_run_readonly_query(text) OWNER TO ai_readonly;
REVOKE CREATE ON SCHEMA public FROM ai_readonly;

-- 6. Tylko service_role (API) może wywołać funkcję. REVOKE od anon/
--    authenticated MUSI wykonać właściciel (ai_readonly).
SET ROLE ai_readonly;
REVOKE EXECUTE ON FUNCTION ai_run_readonly_query(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ai_run_readonly_query(text) TO service_role;
RESET ROLE;
