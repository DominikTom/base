-- SensMax sensors here are bidirectional and configured with "divide by 2"
-- (divideTwo). The /api/v2/sensor/.../data endpoint returns the RAW counter,
-- which is ~2x what the SensMax panel displays as "visits". Apply the /2 in the
-- per-showroom views so the dashboard matches the SensMax panel; the raw values
-- stay in sensmax_hourly_visits.

CREATE OR REPLACE VIEW sensmax_daily_by_showroom AS
SELECT
  s.showroom,
  v.date,
  FLOOR(SUM(CASE WHEN s.divide_two THEN v.visits ELSE v.visits * 2 END) / 2.0)::INTEGER AS visits_total,
  SUM(v.errors)::INTEGER AS errors_total,
  COUNT(DISTINCT v.serial) AS sensors_active
FROM sensmax_hourly_visits v
JOIN sensmax_sensors s ON s.serial = v.serial
WHERE s.active = TRUE AND s.showroom IS NOT NULL
GROUP BY s.showroom, v.date;

CREATE OR REPLACE VIEW sensmax_hourly_by_showroom AS
SELECT
  s.showroom,
  v.date,
  v.hour,
  FLOOR(SUM(CASE WHEN s.divide_two THEN v.visits ELSE v.visits * 2 END) / 2.0)::INTEGER AS visits,
  SUM(v.errors)::INTEGER AS errors,
  COUNT(DISTINCT v.serial) AS sensors_active
FROM sensmax_hourly_visits v
JOIN sensmax_sensors s ON s.serial = v.serial
WHERE s.active = TRUE AND s.showroom IS NOT NULL
GROUP BY s.showroom, v.date, v.hour;
