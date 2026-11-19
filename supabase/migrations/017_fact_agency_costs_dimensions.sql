-- ============================================================
-- Migration 017: Rozszerzenie fact_agency_costs o wymiary sklepu/platformy
-- ============================================================
-- Cel: umożliwić sumowanie kosztów agencji w pivot table per sklep / platforma.
-- Istniejące wiersze zostają z NULL (= „Ogólne" w UI/pivocie).
-- ============================================================

ALTER TABLE fact_agency_costs
  ADD COLUMN IF NOT EXISTS source_shop TEXT,
  ADD COLUMN IF NOT EXISTS platform TEXT;

CREATE INDEX IF NOT EXISTS idx_agency_costs_dims
  ON fact_agency_costs (month, source_shop, platform);
