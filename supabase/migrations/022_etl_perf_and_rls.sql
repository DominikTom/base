-- ============================================================
-- Migration 022: ETL performance (server-side aggregations) + RLS lockdown
--
-- Context: the GDrive CSV cron had not completed a single run since
-- 2026-04-28. Every night it re-downloaded the full export, re-inserted the
-- whole file into raw_erp_orders, then rebuilt aggregations by pulling every
-- fact row into the serverless function over PostgREST. That needs far more
-- than the 300 s function budget, so Vercel killed it mid-flight and the run
-- was auto-closed as stale 45 min later. fact_orders therefore crawled
-- forward a few thousand rows a night and stalled at 2026-09-02.
--
-- The aggregation rebuilds below replace ~600 HTTP round-trips with three
-- single-statement server-side rebuilds.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Daily revenue rebuild (was: fetch all orders -> group in JS -> upsert)
--
-- Buckets by Europe/Warsaw calendar day. The previous JS implementation
-- sliced the UTC ISO string (substring(0,10)), which put orders placed
-- between 00:00 and 02:00 Warsaw time on the PREVIOUS day, while
-- /api/dashboard/widgets buckets with warsawDateKey(). Same metric, two
-- answers depending on the page. Warsaw is the correct basis for a PL
-- retailer and matches the widgets, so it becomes the single convention.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_rebuild_daily_revenue(p_from date, p_to date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RETURN 0;
  END IF;

  -- Recompute the window from scratch so deleted/changed orders cannot
  -- leave stale buckets behind.
  DELETE FROM fact_daily_revenue
  WHERE date >= p_from AND date <= p_to;

  WITH src AS (
    SELECT
      (order_date AT TIME ZONE 'Europe/Warsaw')::date AS d,
      source_shop,
      total_gross_pln,
      total_gross,
      shipping_cost_pln,
      is_paid,
      status,
      currency,
      order_date
    FROM fact_orders
    WHERE (order_date AT TIME ZONE 'Europe/Warsaw')::date >= p_from
      AND (order_date AT TIME ZONE 'Europe/Warsaw')::date <= p_to
      AND source_shop IS NOT NULL
  ), agg AS (
    SELECT
      d AS date,
      source_shop,
      count(*)::int AS orders_count,
      count(*) FILTER (WHERE is_paid)::int AS orders_paid,
      count(*) FILTER (WHERE status = 'anulowane')::int AS orders_cancelled,
      coalesce(sum(total_gross_pln), 0) AS revenue_gross_pln,
      coalesce(sum(total_gross_pln) FILTER (WHERE is_paid), 0) AS revenue_paid_pln,
      coalesce(sum(shipping_cost_pln), 0) AS shipping_revenue_pln,
      coalesce(sum(total_gross), 0) AS revenue_gross_original,
      coalesce((array_agg(currency ORDER BY order_date))[1], 'PLN') AS original_currency
    FROM src
    GROUP BY d, source_shop
  )
  INSERT INTO fact_daily_revenue (
    date, source_shop, orders_count, orders_paid, orders_cancelled,
    revenue_gross_pln, revenue_paid_pln, shipping_revenue_pln,
    revenue_gross_original, original_currency, avg_order_value_pln
  )
  SELECT
    date, source_shop, orders_count, orders_paid, orders_cancelled,
    revenue_gross_pln, revenue_paid_pln, shipping_revenue_pln,
    revenue_gross_original, original_currency,
    CASE WHEN orders_count > 0 THEN revenue_gross_pln / orders_count ELSE 0 END
  FROM agg;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

COMMENT ON FUNCTION fn_rebuild_daily_revenue(date, date) IS
  'Rebuilds fact_daily_revenue for a date window from fact_orders, bucketed by Europe/Warsaw day.';

-- ------------------------------------------------------------
-- 2. dim_products rebuild (was: page all 154k items into the function)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_rebuild_dim_products()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  INSERT INTO dim_products (product_name, product_category, total_orders, total_quantity, updated_at)
  SELECT
    i.product_name,
    (array_agg(i.product_category ORDER BY i.product_category))[1],
    count(DISTINCT i.order_id)::int,
    coalesce(sum(coalesce(i.quantity, 1)), 0),
    now()
  FROM fact_order_items i
  WHERE i.product_name IS NOT NULL
  GROUP BY i.product_name
  ON CONFLICT (product_name) DO UPDATE SET
    product_category = excluded.product_category,
    total_orders     = excluded.total_orders,
    total_quantity   = excluded.total_quantity,
    updated_at       = excluded.updated_at;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- ------------------------------------------------------------
-- 3. dim_fabrics rebuild
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_rebuild_dim_fabrics()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  INSERT INTO dim_fabrics (fabric_name, fabric_collection, total_orders, updated_at)
  SELECT
    i.fabric,
    coalesce((array_agg(i.fabric_collection ORDER BY i.fabric_collection))[1], i.fabric),
    count(DISTINCT i.order_id)::int,
    now()
  FROM fact_order_items i
  WHERE i.fabric IS NOT NULL
  GROUP BY i.fabric
  ON CONFLICT (fabric_name) DO UPDATE SET
    fabric_collection = excluded.fabric_collection,
    total_orders      = excluded.total_orders,
    updated_at        = excluded.updated_at;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- ------------------------------------------------------------
-- 4. raw_erp_orders retention
--
-- The landing table is an audit trail, but the cron appended the entire
-- export on every run with no retention, reaching 30.6M rows for 49k orders
-- (~620 raw rows per order). Keep the N most recent ETL runs.
-- ------------------------------------------------------------
-- No index is created here on purpose: building one on 30.6M rows takes an
-- ACCESS EXCLUSIVE lock for minutes. With ETL_RAW_LANDING off the table is no
-- longer written, so the backlog is a cleanup task, not a hot path. Purge it
-- in batches first (see docs/RUNBOOK-etl.md), then add indexes concurrently
-- outside a transaction if the landing table is ever re-enabled:
--   CREATE INDEX CONCURRENTLY idx_raw_erp_orders_etl_run ON raw_erp_orders (etl_run_id);

CREATE OR REPLACE FUNCTION fn_purge_raw_erp_orders(p_keep_runs integer DEFAULT 3)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted bigint;
BEGIN
  WITH keep AS (
    SELECT etl_run_id
    FROM raw_erp_orders
    WHERE etl_run_id IS NOT NULL
    GROUP BY etl_run_id
    ORDER BY max(loaded_at) DESC
    LIMIT greatest(p_keep_runs, 1)
  )
  DELETE FROM raw_erp_orders r
  WHERE r.etl_run_id IS NULL
     OR r.etl_run_id NOT IN (SELECT etl_run_id FROM keep);

  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

-- ------------------------------------------------------------
-- 5. Reject impossible dates
--
-- The showroom sheet and weather feed carried rows dated 2099-12-31,
-- 2926-02-17 and 5024-06-27. A single row dated year 5024 stretches every
-- chart axis that spans "all data", which is why the dashboard looked
-- scrambled even where numbers were correct.
-- ------------------------------------------------------------
DELETE FROM weather_daily WHERE date > current_date + interval '30 days';
DELETE FROM sensmax_showroom_sales WHERE date > current_date + interval '1 year';

ALTER TABLE weather_daily
  DROP CONSTRAINT IF EXISTS weather_daily_date_sane;
ALTER TABLE weather_daily
  ADD CONSTRAINT weather_daily_date_sane
  CHECK (date >= DATE '2015-01-01' AND date <= DATE '2100-01-01') NOT VALID;

ALTER TABLE sensmax_showroom_sales
  DROP CONSTRAINT IF EXISTS sensmax_showroom_sales_date_sane;
ALTER TABLE sensmax_showroom_sales
  ADD CONSTRAINT sensmax_showroom_sales_date_sane
  CHECK (date >= DATE '2015-01-01' AND date <= DATE '2100-01-01') NOT VALID;

ALTER TABLE fact_orders
  DROP CONSTRAINT IF EXISTS fact_orders_order_date_sane;
ALTER TABLE fact_orders
  ADD CONSTRAINT fact_orders_order_date_sane
  CHECK (order_date >= TIMESTAMPTZ '2015-01-01' AND order_date <= TIMESTAMPTZ '2100-01-01') NOT VALID;

-- ------------------------------------------------------------
-- 6. Row Level Security lockdown
--
-- 26 tables were readable AND writable by anyone holding the anon key,
-- which ships to every browser. raw_erp_orders and fact_orders carry
-- customer names, e-mails, phone numbers and delivery addresses.
--
-- All server-side access goes through getSupabaseAdmin() with
-- SUPABASE_SERVICE_KEY, and the service role bypasses RLS, so enabling RLS
-- with no anon/authenticated policy is a deny-all for public keys while the
-- application keeps working. Verified before applying: the only table the
-- browser reads directly is user_profiles, which already has its own
-- policies; every dashboard read goes through /api/dashboard/* server
-- routes. fact_daily_ad_performance already runs in exactly this
-- configuration (RLS on, zero policies) and its ETL writes succeed daily.
-- ------------------------------------------------------------
ALTER TABLE raw_erp_orders                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_meta_campaigns             ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_ga4_traffic                ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_pinterest_campaigns        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_orders                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_order_items               ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim_exchange_rates             ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim_products                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim_fabrics                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_daily_revenue             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_daily_adspend             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_daily_traffic             ENABLE ROW LEVEL SECURITY;
ALTER TABLE cache_meta_live                ENABLE ROW LEVEL SECURITY;
ALTER TABLE cache_pinterest_live           ENABLE ROW LEVEL SECURITY;
ALTER TABLE etl_log                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_thulium_connections       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_thulium_agent_work_daily  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_thulium_tickets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_thulium_chats_daily       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_thulium_outbound_daily    ENABLE ROW LEVEL SECURITY;
ALTER TABLE insights_cache                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_daily                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim_cities                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_delivery_costs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim_campaigns                  ENABLE ROW LEVEL SECURITY;

-- The rebuild/purge helpers are SECURITY DEFINER and must not be reachable
-- with a public key.
REVOKE EXECUTE ON FUNCTION fn_rebuild_daily_revenue(date, date) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_rebuild_dim_products()            FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_rebuild_dim_fabrics()             FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_purge_raw_erp_orders(integer)     FROM anon, authenticated;

-- Pre-existing RPCs were EXECUTE-able by anon. The upserts write straight
-- into fact_orders / fact_order_items, and fn_try_advisory_lock let any
-- caller take the ETL lock and stall every sync.
--
-- PUBLIC must be named explicitly: CREATE FUNCTION grants EXECUTE to PUBLIC by
-- default and anon inherits it, so revoking from anon alone changes nothing.
REVOKE EXECUTE ON FUNCTION fn_upsert_fact_orders(jsonb)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_upsert_fact_order_items(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_try_advisory_lock(text)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_release_advisory_lock(text)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fn_orders_missing_since(integer)  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 7. Close the RLS bypasses
--
-- Enabling RLS above was not sufficient on its own. Two routes around it:
--
--  a) Six views are SECURITY DEFINER, so they execute with the creator's
--     rights and read straight past RLS. Verified after step 6: `SET ROLE
--     anon; SELECT FROM v_orders_billable` still returned order rows.
--     security_invoker makes a view honour the caller's RLS instead. Server
--     routes use the service role, which bypasses RLS, so they keep working.
--  b) The EXECUTE grants above, for the same PUBLIC-default reason.
-- ------------------------------------------------------------
ALTER VIEW v_orders_billable          SET (security_invoker = on);
ALTER VIEW v_orders_geo               SET (security_invoker = on);
ALTER VIEW v_orders_with_producer     SET (security_invoker = on);
ALTER VIEW dim_creatives_with_tags    SET (security_invoker = on);
ALTER VIEW sensmax_daily_by_showroom  SET (security_invoker = on);
ALTER VIEW sensmax_hourly_by_showroom SET (security_invoker = on);

-- Pin search_path on the pre-existing ETL functions.
ALTER FUNCTION fn_upsert_fact_orders(jsonb)      SET search_path = public;
ALTER FUNCTION fn_upsert_fact_order_items(jsonb) SET search_path = public;
ALTER FUNCTION fn_try_advisory_lock(text)        SET search_path = public;
ALTER FUNCTION fn_release_advisory_lock(text)    SET search_path = public;
ALTER FUNCTION fn_orders_missing_since(integer)  SET search_path = public;
