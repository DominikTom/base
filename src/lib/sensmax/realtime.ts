import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchSensMax } from './client';
import type { RealtimeSnapshot, SensMaxReport, Showroom } from './types';

const TTL_MS = 30_000;

export async function getRealtimeForShowroom(showroom: Showroom): Promise<RealtimeSnapshot> {
  const db = getSupabaseAdmin();
  const { data: snapshot } = await db.from('sensmax_realtime_snapshot').select('*').eq('showroom', showroom).maybeSingle();

  if (snapshot && Date.now() - new Date(snapshot.fetched_at).getTime() < TTL_MS) {
    return snapshot as RealtimeSnapshot;
  }

  const { data: reportConfig, error: reportError } = await db
    .from('sensmax_reports')
    .select('report_id')
    .eq('showroom', showroom)
    .single();

  if (reportError || !reportConfig) {
    throw new Error(`Missing sensmax_reports config for ${showroom}`);
  }

  const report = await fetchSensMax<SensMaxReport>(`/report/${reportConfig.report_id}`, 'realtime');

  const payload: RealtimeSnapshot = {
    showroom,
    inside: report.inside,
    max_capacity: report.max,
    almost_full: report.almostFullPreset,
    offline: report.offline,
    color: report.color,
    message: report.message,
    sensor_last_update: report.date ? new Date(report.date).toISOString() : null,
    fetched_at: new Date().toISOString(),
  };

  await db.from('sensmax_realtime_snapshot').upsert(payload, { onConflict: 'showroom' });
  await db
    .from('sensmax_reports')
    .update({ sensor_group_id: String(report.id), updated_at: new Date().toISOString() })
    .eq('showroom', showroom)
    .is('sensor_group_id', null);

  return payload;
}
