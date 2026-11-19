-- ============================================================
-- 026: Data Hub MyBed — funkcje agregujące dla REST /api/v1 i MCP
-- ============================================================
-- Agregacja w bazie zamiast pobierania wszystkich zamówień stronami po 1000.
-- Definicje (zgodnie z audytem docs/audit/2026-11-panel-zamowien-plan.md):
--   * dzień = data zamówienia w strefie Europe/Warsaw,
--   * sprzedaż = statusy 'zamówienie' i 'zrealizowane' (oferty i anulowane osobno),
--   * kwoty PLN = total_gross_pln (ERP „Suma”, brutto z dostawą; EUR/CZK po NBP).
-- Funkcje SECURITY INVOKER, EXECUTE tylko service_role (API serwera).

-- ── Sprzedaż dzienna per sklep i walutę ─────────────────────
CREATE OR REPLACE FUNCTION hub_sales_daily(p_from date, p_to date, p_shops text[] DEFAULT NULL)
RETURNS TABLE (
    day                     date,
    source_shop             text,
    currency                text,
    orders_total            integer,
    orders_billable         integer,
    orders_paid             integer,
    orders_offer            integer,
    orders_cancelled        integer,
    orders_other            integer,
    revenue_billable_pln    numeric,
    revenue_billable_orig   numeric,
    revenue_paid_pln        numeric,
    shipping_billable_pln   numeric,
    revenue_offer_pln       numeric,
    revenue_cancelled_pln   numeric
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH o AS (
    SELECT
      (order_date AT TIME ZONE 'Europe/Warsaw')::date AS day,
      source_shop, currency, status, is_paid,
      coalesce(total_gross_pln, 0)   AS gross_pln,
      coalesce(total_gross, 0)       AS gross_orig,
      coalesce(shipping_cost_pln, 0) AS shipping_pln,
      status IN ('zamówienie', 'zrealizowane') AS billable
    FROM fact_orders
    WHERE order_date >= (p_from::timestamp AT TIME ZONE 'Europe/Warsaw')
      AND order_date <  ((p_to + 1)::timestamp AT TIME ZONE 'Europe/Warsaw')
      AND (p_shops IS NULL OR source_shop = ANY (p_shops))
  )
  SELECT
    day, source_shop, currency,
    count(*)::int,
    count(*) FILTER (WHERE billable)::int,
    count(*) FILTER (WHERE billable AND is_paid)::int,
    count(*) FILTER (WHERE status = 'oferta')::int,
    count(*) FILTER (WHERE status = 'anulowane')::int,
    count(*) FILTER (WHERE NOT billable AND status NOT IN ('oferta', 'anulowane'))::int,
    coalesce(sum(gross_pln)    FILTER (WHERE billable), 0),
    coalesce(sum(gross_orig)   FILTER (WHERE billable), 0),
    coalesce(sum(gross_pln)    FILTER (WHERE billable AND is_paid), 0),
    coalesce(sum(shipping_pln) FILTER (WHERE billable), 0),
    coalesce(sum(gross_pln)    FILTER (WHERE status = 'oferta'), 0),
    coalesce(sum(gross_pln)    FILTER (WHERE status = 'anulowane'), 0)
  FROM o
  GROUP BY day, source_shop, currency
  ORDER BY day, source_shop, currency;
$$;

-- ── Ranking produktów / atrybutów w sprzedanych zamówieniach ─
-- p_dimension: product | category | fabric_collection | fabric | bed_size |
--              mattress_type | headboard_height | storage_type
CREATE OR REPLACE FUNCTION hub_product_ranking(
    p_from date, p_to date, p_shops text[], p_dimension text,
    p_include_samples boolean DEFAULT false, p_limit integer DEFAULT 50
)
RETURNS TABLE (value text, quantity numeric, orders integer, orders_in_scope integer)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH o AS (
    SELECT order_id
    FROM fact_orders
    WHERE order_date >= (p_from::timestamp AT TIME ZONE 'Europe/Warsaw')
      AND order_date <  ((p_to + 1)::timestamp AT TIME ZONE 'Europe/Warsaw')
      AND status IN ('zamówienie', 'zrealizowane')
      AND (p_shops IS NULL OR source_shop = ANY (p_shops))
  ),
  scope AS (SELECT count(*)::int AS n FROM o),
  items AS (
    SELECT
      CASE p_dimension
        WHEN 'product'           THEN i.product_name
        WHEN 'category'          THEN i.product_category
        WHEN 'fabric_collection' THEN i.fabric_collection
        WHEN 'fabric'            THEN i.fabric
        WHEN 'bed_size'          THEN i.bed_size
        WHEN 'mattress_type'     THEN i.mattress_type
        WHEN 'headboard_height'  THEN i.headboard_height
        WHEN 'storage_type'      THEN i.storage_type
      END AS value,
      coalesce(i.quantity, 1) AS quantity,
      i.order_id
    FROM v_order_items i
    JOIN o ON o.order_id = i.order_id
    WHERE i.item_type = 'product'
      AND (p_include_samples OR NOT i.is_sample)
  )
  SELECT
    btrim(value) AS value,
    sum(quantity) AS quantity,
    count(DISTINCT order_id)::int AS orders,
    (SELECT n FROM scope) AS orders_in_scope
  FROM items
  WHERE value IS NOT NULL AND btrim(value) <> ''
  GROUP BY btrim(value)
  ORDER BY sum(quantity) DESC, count(DISTINCT order_id) DESC
  LIMIT greatest(1, least(coalesce(p_limit, 50), 500));
$$;

-- ── Źródła ruchu GA4 (wiersze szczegółowe, bez __total__) ────
-- ga_revenue w walucie usługi GA4 (mybed.de: EUR) — przeliczenie w API.
CREATE OR REPLACE FUNCTION hub_traffic_sources(p_from date, p_to date, p_hosts text[] DEFAULT NULL)
RETURNS TABLE (hostname text, source text, medium text, sessions bigint, users bigint, transactions bigint, ga_revenue numeric)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT hostname, source, medium,
         sum(sessions)::bigint, sum(users)::bigint, sum(transactions)::bigint,
         coalesce(sum(ga_revenue), 0)
  FROM fact_daily_traffic
  WHERE date BETWEEN p_from AND p_to
    AND source <> '__total__'
    AND (p_hosts IS NULL OR hostname = ANY (p_hosts))
  GROUP BY hostname, source, medium
  ORDER BY sum(sessions) DESC;
$$;

REVOKE ALL ON FUNCTION hub_sales_daily(date, date, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hub_product_ranking(date, date, text[], text, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hub_traffic_sources(date, date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hub_sales_daily(date, date, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION hub_product_ranking(date, date, text[], text, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION hub_traffic_sources(date, date, text[]) TO service_role;
