-- ============================================================
-- Phase 1: Ad-level data + creative dimension + AI tagging
-- ============================================================
-- Cele:
--   1. fact_daily_ad_performance — dzienne metryki na poziomie AD (nie kampania)
--   2. dim_creatives — statyczne metadane kreacji (thumbnail, copy, tagi)
--   3. Wsparcie dla hook rate / video retention (pola video_p25..p100, play_3s)
--   4. auto_tags z Meta API + ai_tags z Claude Vision + manual_tags (override)

-- ============ FACT: AD-LEVEL PERFORMANCE ============

CREATE TABLE IF NOT EXISTS fact_daily_ad_performance (
    date DATE NOT NULL,
    platform TEXT NOT NULL DEFAULT 'meta',
    account_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    campaign_name TEXT,
    adset_id TEXT NOT NULL,
    adset_name TEXT,
    ad_id TEXT NOT NULL,
    ad_name TEXT,
    creative_id TEXT,

    -- Standardowe metryki
    impressions BIGINT DEFAULT 0,
    reach BIGINT DEFAULT 0,
    clicks BIGINT DEFAULT 0,
    spend NUMERIC(12, 2) DEFAULT 0,
    spend_original NUMERIC(12, 2) DEFAULT 0,
    original_currency TEXT,
    conversions INTEGER DEFAULT 0,
    conversion_value NUMERIC(12, 2) DEFAULT 0,
    cpc NUMERIC(10, 4),
    cpm NUMERIC(10, 4),
    ctr NUMERIC(10, 4),
    roas NUMERIC(10, 4),
    frequency NUMERIC(10, 4),

    -- Metryki wideo (do hook rate / hold rate / retention)
    video_play_3s INTEGER DEFAULT 0,       -- hook rate = video_play_3s / impressions
    video_p25_watched INTEGER DEFAULT 0,
    video_p50_watched INTEGER DEFAULT 0,
    video_p75_watched INTEGER DEFAULT 0,
    video_p95_watched INTEGER DEFAULT 0,
    video_p100_watched INTEGER DEFAULT 0,
    thruplays INTEGER DEFAULT 0,            -- 15s albo do końca (≤15s wideo)

    data_source TEXT DEFAULT 'etl',
    imported_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (date, platform, ad_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_perf_date ON fact_daily_ad_performance (date);
CREATE INDEX IF NOT EXISTS idx_ad_perf_creative ON fact_daily_ad_performance (creative_id);
CREATE INDEX IF NOT EXISTS idx_ad_perf_campaign ON fact_daily_ad_performance (campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_perf_adset ON fact_daily_ad_performance (adset_id);
CREATE INDEX IF NOT EXISTS idx_ad_perf_account ON fact_daily_ad_performance (account_id);

-- ============ DIM: CREATIVES ============

CREATE TABLE IF NOT EXISTS dim_creatives (
    creative_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,

    -- Z Meta API
    title TEXT,
    body TEXT,                              -- primary ad copy
    call_to_action_type TEXT,               -- 'SHOP_NOW', 'LEARN_MORE', etc
    thumbnail_url TEXT,                     -- scontent.xx.fbcdn.net (hotlink, odświeżane)
    image_url TEXT,                         -- pełnowymiarowa (jeśli static)
    video_id TEXT,                          -- Meta video ID (jeśli video)
    permalink_url TEXT,                     -- FB permalink jeśli post-based
    format TEXT,                            -- 'video' | 'image' | 'carousel' | 'dynamic'

    -- Auto-tags (z Meta API — deterministyczne, za darmo)
    auto_tags TEXT[] DEFAULT '{}',          -- np. ['video', 'aspect_9_16', 'has_cta']
    aspect_ratio TEXT,                      -- '1:1' | '9:16' | '4:5' | '16:9'
    duration_sec INTEGER,                   -- dla wideo

    -- AI tags (Claude Vision — generowane async)
    ai_tags TEXT[] DEFAULT '{}',            -- np. ['UGC', 'pain-point', 'has-person']
    ai_tag_status TEXT DEFAULT 'pending',   -- 'pending' | 'processing' | 'completed' | 'failed' | 'skipped'
    ai_tagged_at TIMESTAMPTZ,
    ai_tag_error TEXT,
    ai_insights JSONB,                      -- {style, angle, tone, has_person, has_text_overlay, ...}

    -- Manual override (zespół creative może korygować)
    manual_tags TEXT[] DEFAULT '{}',
    manual_notes TEXT,

    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creatives_account ON dim_creatives (account_id);
CREATE INDEX IF NOT EXISTS idx_creatives_format ON dim_creatives (format);
CREATE INDEX IF NOT EXISTS idx_creatives_tag_status ON dim_creatives (ai_tag_status) WHERE ai_tag_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_creatives_auto_tags ON dim_creatives USING GIN (auto_tags);
CREATE INDEX IF NOT EXISTS idx_creatives_ai_tags ON dim_creatives USING GIN (ai_tags);
CREATE INDEX IF NOT EXISTS idx_creatives_manual_tags ON dim_creatives USING GIN (manual_tags);

-- Widok: unified tags (union auto + ai + manual, deduplicated)
CREATE OR REPLACE VIEW dim_creatives_with_tags AS
SELECT
    c.*,
    ARRAY(
        SELECT DISTINCT unnest(c.auto_tags || c.ai_tags || c.manual_tags)
    ) AS all_tags
FROM dim_creatives c;

-- ============ TRIGGER: updated_at ============

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dim_creatives_updated_at ON dim_creatives;
CREATE TRIGGER trg_dim_creatives_updated_at
    BEFORE UPDATE ON dim_creatives
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
