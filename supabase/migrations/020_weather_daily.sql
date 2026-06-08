-- ============================================================
-- Migration 020: Cache pogody do korelacji ze sprzedażą
-- ============================================================
-- Dane z Open-Meteo (archive-api.open-meteo.com — darmowe, bez klucza,
-- historyczne od 1940). Klucz lokalizacji = miasto referencyjne dla rynku:
--   PL  → Warszawa  (52.2297, 21.0122)
--   DE  → Berlin    (52.52, 13.405)
-- ETL dociąga brakujące daty raz dziennie. Strona /dashboard/weather
-- liczy korelację (Pearson) wybranej metryki pogodowej do dziennej
-- sprzedaży z fact_orders.
-- ============================================================

CREATE TABLE IF NOT EXISTS weather_daily (
  date DATE NOT NULL,
  location_key TEXT NOT NULL,
  temp_max NUMERIC,
  temp_min NUMERIC,
  temp_mean NUMERIC,
  precip_mm NUMERIC,
  sunshine_h NUMERIC,
  wind_max NUMERIC,
  raw JSONB,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (date, location_key)
);

CREATE INDEX IF NOT EXISTS idx_weather_daily_date
  ON weather_daily (date DESC);
