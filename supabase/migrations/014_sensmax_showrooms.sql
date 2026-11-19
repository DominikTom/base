-- Expand SensMax showroom set from 3 to 7 locations (Kraków, Katowice, Warszawa,
-- Poznań, Wrocław, Nowa, Marki) and add an hourly-by-showroom aggregate view.

ALTER TABLE sensmax_sensors            DROP CONSTRAINT IF EXISTS sensmax_sensors_showroom_check;
ALTER TABLE sensmax_reports            DROP CONSTRAINT IF EXISTS sensmax_reports_showroom_check;
ALTER TABLE sensmax_realtime_snapshot  DROP CONSTRAINT IF EXISTS sensmax_realtime_snapshot_showroom_check;

ALTER TABLE sensmax_sensors
  ADD CONSTRAINT sensmax_sensors_showroom_check
  CHECK (showroom IN ('krakow','katowice','warszawa','poznan','wroclaw','nowa','marki'));

ALTER TABLE sensmax_reports
  ADD CONSTRAINT sensmax_reports_showroom_check
  CHECK (showroom IN ('krakow','katowice','warszawa','poznan','wroclaw','nowa','marki'));

ALTER TABLE sensmax_realtime_snapshot
  ADD CONSTRAINT sensmax_realtime_snapshot_showroom_check
  CHECK (showroom IN ('krakow','katowice','warszawa','poznan','wroclaw','nowa','marki'));

CREATE OR REPLACE VIEW sensmax_hourly_by_showroom AS
SELECT
  s.showroom,
  v.date,
  v.hour,
  SUM(v.visits)::INTEGER AS visits,
  SUM(v.errors)::INTEGER AS errors,
  COUNT(DISTINCT v.serial) AS sensors_active
FROM sensmax_hourly_visits v
JOIN sensmax_sensors s ON s.serial = v.serial
WHERE s.active = TRUE AND s.showroom IS NOT NULL
GROUP BY s.showroom, v.date, v.hour;
