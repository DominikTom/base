-- ============================================================
-- Migration 005: CSV pipeline hardening
-- Adds idempotency (row_hash, last_seen_at, last_updated_at, first_loaded_at),
-- audit columns to raw_erp_orders + etl_log, UNIQUE constraint on items,
-- billable + producer views, and upsert helper functions.
-- ============================================================

-- ── 1) raw_erp_orders: audit columns ────────────────────────────────────────
ALTER TABLE raw_erp_orders
  ADD COLUMN IF NOT EXISTS csv_row_number INTEGER,
  ADD COLUMN IF NOT EXISTS etl_run_id     UUID,
  ADD COLUMN IF NOT EXISTS source_file    TEXT,
  ADD COLUMN IF NOT EXISTS loaded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_raw_erp_etl_run ON raw_erp_orders(etl_run_id);
CREATE INDEX IF NOT EXISTS idx_raw_erp_loaded  ON raw_erp_orders(loaded_at DESC);

-- ── 2) fact_orders: change tracking ─────────────────────────────────────────
ALTER TABLE fact_orders
  ADD COLUMN IF NOT EXISTS first_loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS row_hash        TEXT;

CREATE INDEX IF NOT EXISTS idx_fact_orders_last_seen ON fact_orders(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_fact_orders_row_hash  ON fact_orders(row_hash);

-- ── 3) fact_order_items: UNIQUE + audit ─────────────────────────────────────
ALTER TABLE fact_order_items
  ADD COLUMN IF NOT EXISTS first_loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Deduplicate before adding UNIQUE: keep the largest id per (order_id, line_number).
DELETE FROM fact_order_items a
USING fact_order_items b
WHERE a.id < b.id
  AND a.order_id = b.order_id
  AND a.line_number = b.line_number;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fact_order_items_uniq'
  ) THEN
    ALTER TABLE fact_order_items
      ADD CONSTRAINT fact_order_items_uniq UNIQUE (order_id, line_number);
  END IF;
END $$;

-- ── 4) etl_log: pipeline / version / details / quarantined ──────────────────
ALTER TABLE etl_log
  ADD COLUMN IF NOT EXISTS pipeline         TEXT,
  ADD COLUMN IF NOT EXISTS version          TEXT,
  ADD COLUMN IF NOT EXISTS rows_quarantined INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS details          JSONB;

UPDATE etl_log SET pipeline = source WHERE pipeline IS NULL;

-- ── 5) Views for dashboards ─────────────────────────────────────────────────
-- Billable orders: only those with revenue impact (excluding offers/cancellations).
CREATE OR REPLACE VIEW v_orders_billable AS
SELECT *
FROM fact_orders
WHERE status IN ('zamówienie', 'zrealizowane');

-- Producer derivation: 8-tag whitelist over operational_tags.
-- Falls back to fact_orders.supplier (legacy hand-classification) if no whitelist match.
CREATE OR REPLACE VIEW v_orders_with_producer AS
SELECT
  o.*,
  CASE
    WHEN array_to_string(o.operational_tags, ',') ILIKE '%comfy%'    THEN 'Comfy'
    WHEN array_to_string(o.operational_tags, ',') ILIKE '%profoam%'  THEN 'Profoam'
    WHEN array_to_string(o.operational_tags, ',') ILIKE '%mobler%'   THEN 'MOBLER'
    WHEN array_to_string(o.operational_tags, ',') ILIKE '%mazur%'    THEN 'Mazur'
    WHEN array_to_string(o.operational_tags, ',') ILIKE '%relax%'    THEN 'RELAX'
    WHEN array_to_string(o.operational_tags, ',') ILIKE '%tobi one%' THEN 'Tobi One'
    WHEN array_to_string(o.operational_tags, ',') ILIKE '%vongai%'   THEN 'VONGAI'
    WHEN array_to_string(o.operational_tags, ',') ILIKE '%włodex%'   THEN 'Włodex'
    ELSE o.supplier
  END AS producer
FROM fact_orders o;

-- ── 6) Upsert helper functions (atomic conditional last_updated_at) ─────────
CREATE OR REPLACE FUNCTION fn_upsert_fact_orders(payload jsonb)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  affected integer;
BEGIN
  WITH upsert_result AS (
    INSERT INTO fact_orders (
      order_id, order_date, expected_date, fulfillment_date,
      source_platform, source_shop, currency,
      total_gross, shipping_cost, exchange_rate,
      total_gross_pln, shipping_cost_pln,
      is_paid, coupon_code, status,
      customer_name, customer_email_hash,
      delivery_city, delivery_zip, delivery_method,
      supplier, production_batch, sales_person, marketplace_tag, operational_tags,
      invoice_production, invoice_mattress, invoice_transport,
      notes,
      row_hash, first_loaded_at, last_seen_at, last_updated_at
    )
    SELECT
      r->>'order_id',
      nullif(r->>'order_date', '')::timestamptz,
      nullif(r->>'expected_date', '')::timestamptz,
      nullif(r->>'fulfillment_date', '')::date,
      r->>'source_platform',
      r->>'source_shop',
      coalesce(r->>'currency', 'PLN'),
      nullif(r->>'total_gross', '')::numeric,
      nullif(r->>'shipping_cost', '')::numeric,
      coalesce(nullif(r->>'exchange_rate', '')::numeric, 1),
      nullif(r->>'total_gross_pln', '')::numeric,
      nullif(r->>'shipping_cost_pln', '')::numeric,
      coalesce((r->>'is_paid')::boolean, false),
      r->>'coupon_code',
      r->>'status',
      r->>'customer_name',
      r->>'customer_email_hash',
      r->>'delivery_city',
      r->>'delivery_zip',
      r->>'delivery_method',
      r->>'supplier',
      r->>'production_batch',
      r->>'sales_person',
      r->>'marketplace_tag',
      ARRAY(SELECT jsonb_array_elements_text(coalesce(r->'operational_tags', '[]'::jsonb))),
      r->>'invoice_production',
      r->>'invoice_mattress',
      r->>'invoice_transport',
      r->>'notes',
      r->>'row_hash',
      now(), now(), now()
    FROM jsonb_array_elements(payload) AS r
    ON CONFLICT (order_id) DO UPDATE SET
      order_date         = EXCLUDED.order_date,
      expected_date      = EXCLUDED.expected_date,
      fulfillment_date   = EXCLUDED.fulfillment_date,
      source_platform    = EXCLUDED.source_platform,
      source_shop        = EXCLUDED.source_shop,
      currency           = EXCLUDED.currency,
      total_gross        = EXCLUDED.total_gross,
      shipping_cost      = EXCLUDED.shipping_cost,
      exchange_rate      = EXCLUDED.exchange_rate,
      total_gross_pln    = EXCLUDED.total_gross_pln,
      shipping_cost_pln  = EXCLUDED.shipping_cost_pln,
      is_paid            = EXCLUDED.is_paid,
      coupon_code        = EXCLUDED.coupon_code,
      status             = EXCLUDED.status,
      customer_name      = EXCLUDED.customer_name,
      customer_email_hash= EXCLUDED.customer_email_hash,
      delivery_city      = EXCLUDED.delivery_city,
      delivery_zip       = EXCLUDED.delivery_zip,
      delivery_method    = EXCLUDED.delivery_method,
      supplier           = EXCLUDED.supplier,
      production_batch   = EXCLUDED.production_batch,
      sales_person       = EXCLUDED.sales_person,
      marketplace_tag    = EXCLUDED.marketplace_tag,
      operational_tags   = EXCLUDED.operational_tags,
      invoice_production = EXCLUDED.invoice_production,
      invoice_mattress   = EXCLUDED.invoice_mattress,
      invoice_transport  = EXCLUDED.invoice_transport,
      notes              = EXCLUDED.notes,
      last_seen_at       = EXCLUDED.last_seen_at,
      last_updated_at    = CASE
        WHEN fact_orders.row_hash IS DISTINCT FROM EXCLUDED.row_hash
        THEN EXCLUDED.last_updated_at
        ELSE fact_orders.last_updated_at
      END,
      row_hash           = EXCLUDED.row_hash
      -- first_loaded_at is intentionally not in the update list (preserved on existing rows)
    RETURNING 1
  )
  SELECT count(*) INTO affected FROM upsert_result;
  RETURN affected;
END $$;

CREATE OR REPLACE FUNCTION fn_upsert_fact_order_items(payload jsonb)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  affected integer;
BEGIN
  WITH upsert_result AS (
    INSERT INTO fact_order_items (
      order_id, line_number, product_name, product_category, quantity, item_type,
      bed_size, mattress_type, fabric, fabric_collection,
      headboard_height, storage_type, headboard_type, bed_side,
      storage_opening, mattress_hardness, pillows_choice, duvet_choice, legs_type,
      raw_options, options_language,
      first_loaded_at, last_seen_at
    )
    SELECT
      r->>'order_id',
      (r->>'line_number')::integer,
      r->>'product_name',
      r->>'product_category',
      coalesce(nullif(r->>'quantity', '')::numeric, 1),
      r->>'item_type',
      r->>'bed_size',
      r->>'mattress_type',
      r->>'fabric',
      r->>'fabric_collection',
      r->>'headboard_height',
      r->>'storage_type',
      r->>'headboard_type',
      r->>'bed_side',
      r->>'storage_opening',
      r->>'mattress_hardness',
      r->>'pillows_choice',
      r->>'duvet_choice',
      r->>'legs_type',
      r->>'raw_options',
      r->>'options_language',
      now(), now()
    FROM jsonb_array_elements(payload) AS r
    ON CONFLICT (order_id, line_number) DO UPDATE SET
      product_name      = EXCLUDED.product_name,
      product_category  = EXCLUDED.product_category,
      quantity          = EXCLUDED.quantity,
      item_type         = EXCLUDED.item_type,
      bed_size          = EXCLUDED.bed_size,
      mattress_type     = EXCLUDED.mattress_type,
      fabric            = EXCLUDED.fabric,
      fabric_collection = EXCLUDED.fabric_collection,
      headboard_height  = EXCLUDED.headboard_height,
      storage_type      = EXCLUDED.storage_type,
      headboard_type    = EXCLUDED.headboard_type,
      bed_side          = EXCLUDED.bed_side,
      storage_opening   = EXCLUDED.storage_opening,
      mattress_hardness = EXCLUDED.mattress_hardness,
      pillows_choice    = EXCLUDED.pillows_choice,
      duvet_choice      = EXCLUDED.duvet_choice,
      legs_type         = EXCLUDED.legs_type,
      raw_options       = EXCLUDED.raw_options,
      options_language  = EXCLUDED.options_language,
      last_seen_at      = EXCLUDED.last_seen_at
      -- first_loaded_at preserved
    RETURNING 1
  )
  SELECT count(*) INTO affected FROM upsert_result;
  RETURN affected;
END $$;

-- ── 7) Detect missing orders helper (orders not seen in last N days) ───────
CREATE OR REPLACE FUNCTION fn_orders_missing_since(threshold_days integer DEFAULT 2)
RETURNS TABLE (order_id text, last_seen_at timestamptz, status text)
LANGUAGE sql
AS $$
  SELECT order_id, last_seen_at, status
  FROM fact_orders
  WHERE last_seen_at < (now() - make_interval(days => threshold_days))
    AND status NOT IN ('anulowane')
  ORDER BY last_seen_at DESC
  LIMIT 200;
$$;
