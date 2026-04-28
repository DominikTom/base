-- ============================================================
-- Migration 008: fact_agency_costs
-- Manual entries of marketing agency / service spend, used by
-- /api/dashboard/costs and the MER widget in /api/dashboard/widgets.
-- ============================================================

CREATE TABLE IF NOT EXISTS fact_agency_costs (
  id BIGSERIAL PRIMARY KEY,
  month DATE NOT NULL,
  agency_name TEXT NOT NULL,
  service_type TEXT NOT NULL,
  amount_pln NUMERIC(14,2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fact_agency_costs_month ON fact_agency_costs(month DESC);
