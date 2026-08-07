-- ============================================================
-- Tagi manualne kampanii (feedback Kamili)
-- ============================================================
-- Zespół marketingu tworzy własne tagi na kampaniach (np. 'test kreacji',
-- 'blackweek', 'influencer') i filtruje po nich zakładki. Kreacje mają już
-- manual_tags od migracji 003 — tu wyrównujemy kampanie.

ALTER TABLE dim_campaigns
    ADD COLUMN IF NOT EXISTS manual_tags TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_dim_campaigns_manual_tags
    ON dim_campaigns USING GIN (manual_tags);
