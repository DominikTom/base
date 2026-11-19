-- ============================================================
-- Migration 019: Cache dla komponentu „AI Wskazówki"
-- ============================================================
-- Wskazówki na dashboardzie liczą się 1×/h (deterministyczne metryki +
-- pisane stylem przez Claude API). Cache trzymamy w tabeli żeby przeżyć
-- redeploy i nie palić tokenów LLM przy każdym wejściu.
--
-- scope_key:  np. „dashboard:all:7d"  / „dashboard:mybed.pl:30d" — zawiera
--             wszystkie wymiary po których cache się dzieli.
-- payload:    { insights: [{title, body, badge: '+18%'|'-40%'|null, kind}], ranges: {...} }
-- ============================================================

CREATE TABLE IF NOT EXISTS insights_cache (
  scope_key TEXT PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_insights_cache_generated_at
  ON insights_cache (generated_at DESC);
