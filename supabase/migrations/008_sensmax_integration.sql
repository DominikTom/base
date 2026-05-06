CREATE TABLE sensmax_sensors (
  serial          TEXT PRIMARY KEY,
  name            TEXT,
  description     TEXT,
  group_id        TEXT,
  showroom        TEXT CHECK (showroom IN ('katowice','wroclaw','poznan')),
  divide_two      BOOLEAN DEFAULT FALSE,
  negative        BOOLEAN DEFAULT FALSE,
  staff           INTEGER DEFAULT 0,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sensmax_reports (
  showroom         TEXT PRIMARY KEY CHECK (showroom IN ('katowice','wroclaw','poznan')),
  report_id        TEXT NOT NULL,
  sensor_group_id  TEXT,
  display_name     TEXT,
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sensmax_hourly_visits (
  id                BIGSERIAL PRIMARY KEY,
  serial            TEXT NOT NULL REFERENCES sensmax_sensors(serial) ON DELETE CASCADE,
  date              DATE NOT NULL,
  hour              SMALLINT NOT NULL CHECK (hour BETWEEN 0 AND 23),
  visits            INTEGER NOT NULL DEFAULT 0,
  errors            INTEGER NOT NULL DEFAULT 0,
  battery           SMALLINT,
  first_entry_time  TIME,
  last_entry_time   TIME,
  fetched_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (serial, date, hour)
);

CREATE INDEX idx_sensmax_visits_date         ON sensmax_hourly_visits (date DESC);
CREATE INDEX idx_sensmax_visits_serial_date  ON sensmax_hourly_visits (serial, date DESC);

CREATE TABLE sensmax_realtime_snapshot (
  showroom        TEXT PRIMARY KEY CHECK (showroom IN ('katowice','wroclaw','poznan')),
  inside          INTEGER,
  max_capacity    INTEGER,
  almost_full     INTEGER,
  offline         BOOLEAN DEFAULT FALSE,
  color           TEXT,
  message         TEXT,
  sensor_last_update TIMESTAMPTZ,
  fetched_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sensmax_sync_log (
  id              BIGSERIAL PRIMARY KEY,
  kind            TEXT NOT NULL,
  serial          TEXT,
  status          TEXT NOT NULL,
  http_status     INTEGER,
  message         TEXT,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sensmax_sync_log_created ON sensmax_sync_log (created_at DESC);

CREATE VIEW sensmax_daily_by_showroom AS
SELECT
  s.showroom,
  v.date,
  SUM(v.visits)::INTEGER  AS visits_total,
  SUM(v.errors)::INTEGER  AS errors_total,
  COUNT(DISTINCT v.serial) AS sensors_active
FROM sensmax_hourly_visits v
JOIN sensmax_sensors s ON s.serial = v.serial
WHERE s.active = TRUE AND s.showroom IS NOT NULL
GROUP BY s.showroom, v.date;

ALTER TABLE sensmax_sensors            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensmax_reports            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensmax_hourly_visits      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensmax_realtime_snapshot  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensmax_sync_log           ENABLE ROW LEVEL SECURITY;
