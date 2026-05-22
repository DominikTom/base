-- ============================================================
-- Migration 011: Widok v_order_items + flaga is_sample
-- ============================================================
-- Problem: fact_order_items miesza realne produkty z darmowymi próbkami
-- tkanin. Kategoryzacja próbek jest niespójna między sklepami:
--   * mybed.pl / mybed.de — próbki mają product_category = 'próbki'
--   * mittohome.pl        — próbki mają product_category = 'inne' albo
--     (przez błąd reguły /bett/ w ETL) 'łóżko'. Ich nazwa to zawsze
--     "<nazwa tkaniny> <numer odcienia>", np. "Find Me 19", "Corbett 8".
--
-- Rozwiązanie: widok v_order_items = fact_order_items + wyliczona kolumna
-- is_sample. Zbiór nazw tkanin pochodzi z kolumny fabric_collection
-- realnych zamówień (tam, gdzie klient wybrał tkaninę do mebla/łóżka).
--
-- Widok jest zawsze aktualny (przelicza się przy odczycie) — brak
-- backfillu, triggerów ani sprzężenia z ETL. security_invoker = true →
-- widok respektuje uprawnienia odpytującej roli (zgodne z ai_readonly).
-- ============================================================

CREATE OR REPLACE VIEW v_order_items
WITH (security_invoker = true) AS
WITH fabric_set AS (
  SELECT DISTINCT lower(btrim(fabric_collection)) AS fc
  FROM fact_order_items
  WHERE fabric_collection IS NOT NULL AND btrim(fabric_collection) <> ''
)
SELECT
  i.*,
  (
    i.product_category = 'próbki'
    OR (
      i.item_type = 'product'
      AND lower(btrim(i.product_name)) ~ '\s\d+\s*$'
      AND regexp_replace(lower(btrim(i.product_name)), '\s+\d+\s*$', '') IN (SELECT fc FROM fabric_set)
    )
  ) AS is_sample
FROM fact_order_items i;

GRANT SELECT ON v_order_items TO ai_readonly, service_role, authenticated, anon;
