import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchSensMax, logSyncEvent } from './client';
import { canFetchHistoricalData } from './rateLimiter';
import type { SensMaxSensor, SensMaxSensorDataDay } from './types';

export async function refreshSensorsList() {
  const sensors = await fetchSensMax<SensMaxSensor[]>('/sensors', 'sensor_list');
  const rows = sensors.map((s) => ({
    serial: s.serial,
    name: s.name,
    description: s.description,
    group_id: s.group,
    divide_two: Boolean(s.divideTwo),
    negative: Boolean(s.negative),
    staff: s.staff ?? 0,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    await getSupabaseAdmin().from('sensmax_sensors').upsert(rows, { onConflict: 'serial' });
  }

  return rows.length;
}

export async function syncHistorical() {
  const db = getSupabaseAdmin();
  const { data: sensors, error } = await db
    .from('sensmax_sensors')
    .select('serial')
    .eq('active', true)
    .not('showroom', 'is', null);

  if (error) throw error;

  let sensorsSynced = 0;
  let rowsUpserted = 0;
  let rateLimited = false;
  let errors = 0;

  for (const sensor of sensors ?? []) {
    const allowed = await canFetchHistoricalData();
    if (!allowed) {
      rateLimited = true;
      await logSyncEvent({ kind: 'historical', serial: sensor.serial, status: 'rate_limited', message: 'Historical token bucket exhausted' });
      break;
    }

    try {
      const updatedDatesResponse = await fetchSensMax<{ updated_data_dates?: string[] }>(`/sensor/${sensor.serial}/updateddates`, 'historical', sensor.serial);
      const minDate = new Date();
      minDate.setDate(minDate.getDate() - 30);
      const dates = (updatedDatesResponse.updated_data_dates ?? []).filter((d) => new Date(d) >= minDate).sort();

      if (dates.length === 0) continue;

      const start = dates[0];
      const end = dates[dates.length - 1];
      const data = await fetchSensMax<SensMaxSensorDataDay[]>(`/sensor/${sensor.serial}/data?start=${start}&end=${end}`, 'historical', sensor.serial);

      const upserts: Array<Record<string, unknown>> = [];
      for (const day of data) {
        for (let hour = 0; hour < 24; hour += 1) {
          upserts.push({
            serial: sensor.serial,
            date: day.date,
            hour,
            visits: Number.parseInt(day.visits?.[hour] ?? '0', 10) || 0,
            errors: Number.parseInt(day.errors?.[hour] ?? '0', 10) || 0,
            battery: day.battery,
            first_entry_time: day.firstEntryTime || null,
            last_entry_time: day.lastEntryTime || null,
            fetched_at: new Date().toISOString(),
          });
        }
      }

      if (upserts.length > 0) {
        const { error: upsertError } = await db.from('sensmax_hourly_visits').upsert(upserts, { onConflict: 'serial,date,hour' });
        if (upsertError) throw upsertError;
        rowsUpserted += upserts.length;
      }
      sensorsSynced += 1;
    } catch {
      errors += 1;
    }
  }

  return { sensors_synced: sensorsSynced, rows_upserted: rowsUpserted, rate_limited: rateLimited, errors };
}
