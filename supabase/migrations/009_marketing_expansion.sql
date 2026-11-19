-- ============================================================
-- Marketing expansion: dim_campaigns + leads + atrybucja
-- ============================================================
-- Cele:
--   1. dim_campaigns — wymiar kampanii: objective z Meta API + pola manualne
--      (cel wewnętrzny, etap lejka, notatka) edytowalne z dashboardu
--   2. fact_daily_ad_performance — metryki leadowe (leads, cost per lead
--      liczony w API) + rozbicie konwersji na okna atrybucji
--      (1d_click / 7d_click / 1d_view; kolumny bazowe conversions/
--      conversion_value pozostają oknem domyślnym konta)

-- ============ DIM: CAMPAIGNS ============

CREATE TABLE IF NOT EXISTS dim_campaigns (
    campaign_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,

    -- Z Meta API (nadpisywane przy każdym syncu)
    name TEXT,
    objective TEXT,                         -- np. 'OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_AWARENESS'
    status TEXT,                            -- 'ACTIVE' | 'PAUSED' | ...
    effective_status TEXT,
    buying_type TEXT,
    daily_budget NUMERIC(12, 2),            -- w walucie konta
    lifetime_budget NUMERIC(12, 2),
    start_time TIMESTAMPTZ,
    stop_time TIMESTAMPTZ,

    -- Pola manualne (zespół marketingu; sync NIE nadpisuje)
    purpose TEXT,                           -- wewnętrzny cel, np. 'test kreacji', 'feedowanie bazy kontaktów'
    funnel_stage TEXT,                      -- 'TOFU' | 'MOFU' | 'BOFU' | 'Retargeting' | 'Retencja'
    notes TEXT,                             -- krótka notatka

    first_seen_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dim_campaigns_account ON dim_campaigns (account_id);
CREATE INDEX IF NOT EXISTS idx_dim_campaigns_objective ON dim_campaigns (objective);
CREATE INDEX IF NOT EXISTS idx_dim_campaigns_funnel ON dim_campaigns (funnel_stage);

DROP TRIGGER IF EXISTS trg_dim_campaigns_updated_at ON dim_campaigns;
CREATE TRIGGER trg_dim_campaigns_updated_at
    BEFORE UPDATE ON dim_campaigns
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============ FACT: leads + okna atrybucji ============

ALTER TABLE fact_daily_ad_performance
    ADD COLUMN IF NOT EXISTS leads INTEGER DEFAULT 0,
    -- Konwersje (purchase) per okno atrybucji. Kolumny bazowe
    -- conversions/conversion_value = okno domyślne konta (zwykle 7d_click+1d_view).
    ADD COLUMN IF NOT EXISTS conversions_1d_click INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS conversions_7d_click INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS conversions_1d_view INTEGER DEFAULT 0,
    -- Wartości konwersji per okno, przeliczone na PLN jak conversion_value
    ADD COLUMN IF NOT EXISTS conversion_value_1d_click NUMERIC(12, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS conversion_value_7d_click NUMERIC(12, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS conversion_value_1d_view NUMERIC(12, 2) DEFAULT 0;
