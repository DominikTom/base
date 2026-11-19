-- Per-showroom sales pulled from the Google Sheets the showroom staff maintain
-- (one sheet per sales showroom, monthly tabs). Used to compute conversion vs.
-- the SensMax footfall counts.

CREATE TABLE IF NOT EXISTS sensmax_showroom_sales (
  id                  BIGSERIAL PRIMARY KEY,
  showroom            TEXT NOT NULL CHECK (showroom IN ('krakow','katowice','warszawa','poznan','wroclaw','nowa','marki')),
  date                DATE NOT NULL,
  orders              INTEGER NOT NULL DEFAULT 0,
  revenue_pln         NUMERIC(14,2) NOT NULL DEFAULT 0,
  booked_orders       INTEGER NOT NULL DEFAULT 0,
  booked_revenue_pln  NUMERIC(14,2) NOT NULL DEFAULT 0,
  source_sheet_id     TEXT,
  fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (showroom, date)
);

CREATE INDEX IF NOT EXISTS idx_sensmax_sales_date ON sensmax_showroom_sales (date DESC);

ALTER TABLE sensmax_showroom_sales ENABLE ROW LEVEL SECURITY;
