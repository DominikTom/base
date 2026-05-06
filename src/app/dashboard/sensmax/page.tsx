import { getRealtimeForShowroom } from '@/lib/sensmax/realtime';
import { LiveCounter } from './components/LiveCounter';
import { DailyTrendChart } from './components/DailyTrendChart';
import { HourlyHeatmap } from './components/HourlyHeatmap';
import type { RealtimeSnapshot } from '@/lib/sensmax/types';

export const dynamic = 'force-dynamic';

function fallback(showroom: RealtimeSnapshot['showroom']): RealtimeSnapshot {
  return {
    showroom,
    inside: 0,
    max_capacity: null,
    almost_full: null,
    offline: true,
    color: null,
    message: 'Brak konfiguracji SensMax',
    sensor_last_update: null,
    fetched_at: new Date(0).toISOString(),
  };
}

export default async function SensmaxDashboardPage() {
  const [katowice, wroclaw, poznan] = await Promise.all([
    getRealtimeForShowroom('katowice').catch(() => fallback('katowice')),
    getRealtimeForShowroom('wroclaw').catch(() => fallback('wroclaw')),
    getRealtimeForShowroom('poznan').catch(() => fallback('poznan')),
  ]);

  return (
    <div className="space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Showroomy</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <LiveCounter showroom="katowice" initial={katowice} />
        <LiveCounter showroom="wroclaw" initial={wroclaw} />
        <LiveCounter showroom="poznan" initial={poznan} />
      </div>
      <DailyTrendChart />
      <HourlyHeatmap />
    </div>
  );
}
