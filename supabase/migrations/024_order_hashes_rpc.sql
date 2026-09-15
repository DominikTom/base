-- ============================================================
-- Migration 024: expose existing order hashes for ETL change detection
-- ============================================================
--
-- fn_upsert_fact_orders rewrites every row it is handed; row_hash only decides
-- whether last_updated_at moves. So each nightly run re-upserted all 49k orders
-- and ~170k items even when the export had not changed a single byte — ~130 RPC
-- round-trips of pure waste. Run #668 spent its whole 240 s budget on that and
-- finished `partial`.
--
-- This returns the order_id -> row_hash map so the ETL can send only the rows
-- that actually differ. One call replaces ~50 paged reads.

CREATE OR REPLACE FUNCTION fn_order_hashes()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_object_agg(order_id, row_hash), '{}'::jsonb)
  FROM fact_orders
  WHERE row_hash IS NOT NULL;
$$;

COMMENT ON FUNCTION fn_order_hashes() IS
  'order_id -> row_hash for every order, so the ETL can skip unchanged rows.';

-- SECURITY DEFINER over the whole order table: service role only.
-- PUBLIC must be named explicitly — CREATE FUNCTION grants EXECUTE to PUBLIC by
-- default and anon inherits it, so revoking from anon alone is a no-op.
REVOKE EXECUTE ON FUNCTION fn_order_hashes() FROM PUBLIC, anon, authenticated;
