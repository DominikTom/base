-- ============================================================
-- MyBed Group Data Warehouse — Initial Schema
-- ============================================================

-- ============ RAW / STAGING TABLES ============

CREATE TABLE raw_erp_orders (
    id BIGSERIAL PRIMARY KEY,
    numer TEXT,
    data_zamowienia TIMESTAMPTZ,
    przewidywana_data TIMESTAMPTZ,
    produkt_nazwa TEXT,
    ilosc DECIMAL(10,2),
    opcja TEXT,
    metoda_dostawy TEXT,
    kod_pocztowy TEXT,
    miasto TEXT,
    suma DECIMAL(12,2),
    koszt_dostawy DECIMAL(10,2),
    uwagi TEXT,
    zaplacone TEXT,
    status TEXT,
    tagi TEXT,
    data_realizacji DATE,
    kupon_rabatowy TEXT,
    faktura_produkcyjna TEXT,
    faktura_materac TEXT,
    faktura_transportowa TEXT,
    klient_nazwa TEXT,
    klient_email TEXT,
    klient_telefon TEXT,
    adres_ulica TEXT,
    imported_at TIMESTAMPTZ DEFAULT NOW(),
    csv_filename TEXT,
    row_number INTEGER
);

CREATE TABLE raw_meta_campaigns (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL,
    campaign_id TEXT NOT NULL,
    campaign_name TEXT,
    adset_id TEXT,
    adset_name TEXT,
    ad_id TEXT,
    ad_name TEXT,
    impressions INTEGER,
    clicks INTEGER,
    spend DECIMAL(10,2),
    conversions INTEGER,
    conversion_value DECIMAL(12,2),
    cpc DECIMAL(10,4),
    cpm DECIMAL(10,4),
    ctr DECIMAL(10,4),
    reach INTEGER,
    frequency DECIMAL(10,4),
    objective TEXT,
    account_id TEXT,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE raw_ga4_traffic (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL,
    source TEXT,
    medium TEXT,
    campaign TEXT,
    sessions INTEGER,
    users INTEGER,
    new_users INTEGER,
    pageviews INTEGER,
    bounce_rate DECIMAL(5,4),
    avg_session_duration DECIMAL(10,2),
    transactions INTEGER,
    revenue DECIMAL(12,2),
    hostname TEXT,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE raw_pinterest_campaigns (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL,
    campaign_id TEXT NOT NULL,
    campaign_name TEXT,
    ad_group_id TEXT,
    ad_group_name TEXT,
    impressions INTEGER,
    clicks INTEGER,
    spend DECIMAL(10,2),
    conversions INTEGER,
    conversion_value DECIMAL(12,2),
    account_id TEXT,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============ FACT TABLES ============

CREATE TABLE fact_orders (
    order_id TEXT PRIMARY KEY,
    order_date TIMESTAMPTZ NOT NULL,
    expected_date TIMESTAMPTZ,
    fulfillment_date DATE,
    source_platform TEXT NOT NULL,
    source_shop TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'PLN',
    total_gross DECIMAL(12,2),
    shipping_cost DECIMAL(10,2),
    exchange_rate DECIMAL(10,4) DEFAULT 1,
    total_gross_pln DECIMAL(12,2),
    shipping_cost_pln DECIMAL(10,2),
    is_paid BOOLEAN DEFAULT FALSE,
    coupon_code TEXT,
    status TEXT NOT NULL,
    customer_name TEXT,
    customer_email_hash TEXT,
    delivery_city TEXT,
    delivery_zip TEXT,
    delivery_method TEXT,
    supplier TEXT,
    production_batch TEXT,
    sales_person TEXT,
    marketplace_tag TEXT,
    operational_tags TEXT[],
    invoice_production TEXT,
    invoice_mattress TEXT,
    invoice_transport TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_date ON fact_orders(order_date);
CREATE INDEX idx_orders_shop ON fact_orders(source_shop);
CREATE INDEX idx_orders_status ON fact_orders(status);
CREATE INDEX idx_orders_supplier ON fact_orders(supplier);

CREATE TABLE fact_order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES fact_orders(order_id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    product_category TEXT NOT NULL,
    quantity DECIMAL(10,2) DEFAULT 1,
    item_type TEXT NOT NULL,
    bed_size TEXT,
    mattress_type TEXT,
    fabric TEXT,
    fabric_collection TEXT,
    headboard_height TEXT,
    storage_type TEXT,
    headboard_type TEXT,
    bed_side TEXT,
    storage_opening TEXT,
    mattress_hardness TEXT,
    pillows_choice TEXT,
    duvet_choice TEXT,
    legs_type TEXT,
    raw_options TEXT,
    options_language TEXT
);

CREATE INDEX idx_items_order ON fact_order_items(order_id);
CREATE INDEX idx_items_category ON fact_order_items(product_category);
CREATE INDEX idx_items_fabric ON fact_order_items(fabric_collection);

-- ============ DIMENSION TABLES ============

CREATE TABLE dim_exchange_rates (
    date DATE NOT NULL,
    currency TEXT NOT NULL,
    rate_to_pln DECIMAL(10,4) NOT NULL,
    source TEXT DEFAULT 'nbp',
    PRIMARY KEY (date, currency)
);

CREATE TABLE dim_products (
    product_name TEXT PRIMARY KEY,
    product_category TEXT NOT NULL,
    total_orders INTEGER DEFAULT 0,
    total_quantity DECIMAL(12,2) DEFAULT 0,
    first_sold DATE,
    last_sold DATE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE dim_fabrics (
    fabric_name TEXT PRIMARY KEY,
    fabric_collection TEXT NOT NULL,
    total_orders INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============ AGGREGATION TABLES ============

CREATE TABLE fact_daily_revenue (
    date DATE NOT NULL,
    source_shop TEXT NOT NULL,
    orders_count INTEGER,
    orders_paid INTEGER,
    orders_cancelled INTEGER,
    revenue_gross_pln DECIMAL(14,2),
    revenue_paid_pln DECIMAL(14,2),
    shipping_revenue_pln DECIMAL(12,2),
    avg_order_value_pln DECIMAL(10,2),
    revenue_gross_original DECIMAL(14,2),
    original_currency TEXT DEFAULT 'PLN',
    revenue_beds DECIMAL(14,2),
    revenue_mattresses DECIMAL(14,2),
    revenue_accessories DECIMAL(14,2),
    revenue_furniture DECIMAL(14,2),
    revenue_other DECIMAL(14,2),
    PRIMARY KEY (date, source_shop)
);

CREATE TABLE fact_daily_adspend (
    date DATE NOT NULL,
    platform TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    campaign_name TEXT,
    adset_name TEXT,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    spend DECIMAL(10,2) DEFAULT 0,
    spend_original DECIMAL(10,2) DEFAULT 0,
    original_currency TEXT DEFAULT 'PLN',
    conversions INTEGER DEFAULT 0,
    conversion_value DECIMAL(12,2) DEFAULT 0,
    cpc DECIMAL(10,4),
    cpm DECIMAL(10,4),
    ctr DECIMAL(10,6),
    roas DECIMAL(10,4),
    account_id TEXT,
    data_source TEXT DEFAULT 'etl',
    PRIMARY KEY (date, platform, campaign_id)
);

CREATE INDEX idx_adspend_date ON fact_daily_adspend(date);
CREATE INDEX idx_adspend_platform ON fact_daily_adspend(platform);

CREATE TABLE fact_daily_traffic (
    date DATE NOT NULL,
    source TEXT NOT NULL,
    medium TEXT NOT NULL,
    campaign TEXT NOT NULL DEFAULT '',
    hostname TEXT NOT NULL,
    sessions INTEGER DEFAULT 0,
    users INTEGER DEFAULT 0,
    new_users INTEGER DEFAULT 0,
    pageviews INTEGER DEFAULT 0,
    bounce_rate DECIMAL(5,4),
    avg_session_duration DECIMAL(10,2),
    transactions INTEGER DEFAULT 0,
    ga_revenue DECIMAL(12,2) DEFAULT 0,
    PRIMARY KEY (date, source, medium, hostname, campaign)
);

-- ============ CACHE TABLES ============

CREATE TABLE cache_meta_live (
    date DATE NOT NULL,
    campaign_id TEXT NOT NULL,
    campaign_name TEXT,
    adset_name TEXT,
    spend DECIMAL(10,2),
    impressions INTEGER,
    clicks INTEGER,
    conversions INTEGER,
    conversion_value DECIMAL(12,2),
    roas DECIMAL(10,4),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (date, campaign_id)
);

CREATE TABLE cache_pinterest_live (
    date DATE NOT NULL,
    campaign_id TEXT NOT NULL,
    campaign_name TEXT,
    spend DECIMAL(10,2),
    impressions INTEGER,
    clicks INTEGER,
    conversions INTEGER,
    conversion_value DECIMAL(12,2),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (date, campaign_id)
);

-- ============ ETL / ADMIN TABLES ============

CREATE TABLE etl_log (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL,
    rows_processed INTEGER DEFAULT 0,
    rows_inserted INTEGER DEFAULT 0,
    rows_updated INTEGER DEFAULT 0,
    rows_deleted INTEGER DEFAULT 0,
    error_message TEXT,
    csv_filename TEXT,
    date_range_start DATE,
    date_range_end DATE
);

CREATE TABLE reconciliation_log (
    id BIGSERIAL PRIMARY KEY,
    run_date DATE NOT NULL,
    source TEXT NOT NULL,
    metric TEXT NOT NULL,
    db_value DECIMAL(14,2),
    api_value DECIMAL(14,2),
    difference DECIMAL(14,2),
    difference_pct DECIMAL(8,4),
    status TEXT
);
