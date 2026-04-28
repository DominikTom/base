-- ============================================================
-- Migration 006: ETL quarantine table
-- Stores rows that failed parsing/validation during CSV import.
-- ============================================================

CREATE TABLE IF NOT EXISTS etl_quarantine (
  id              BIGSERIAL PRIMARY KEY,
  etl_run_id      UUID NOT NULL,
  source_file     TEXT,
  csv_row_number  INTEGER,
  raw_data        JSONB NOT NULL,
  error_message   TEXT NOT NULL,
  error_kind      TEXT,                       -- 'parse' | 'validation' | 'mapping' | 'db'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quarantine_run     ON etl_quarantine(etl_run_id);
CREATE INDEX IF NOT EXISTS idx_quarantine_created ON etl_quarantine(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quarantine_kind    ON etl_quarantine(error_kind);
