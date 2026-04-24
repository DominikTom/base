-- ============================================================
-- Phase 3: Dynamic Product Ad (DPA) detection flag
-- ============================================================
-- Meta DPA creatives to template'y — preview pokazuje {{product.name}}
-- zamiast rzeczywistej reklamy. Flagowanie ich pozwala pokazać w UI
-- dedykowany komunikat ("to szablon") zamiast bezużytecznego embed'u.

ALTER TABLE dim_creatives
    ADD COLUMN IF NOT EXISTS is_dynamic BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_creatives_is_dynamic
    ON dim_creatives (is_dynamic)
    WHERE is_dynamic = TRUE;
