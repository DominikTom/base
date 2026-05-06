import { getRealtimeForShowroom } from '@/lib/sensmax/realtime';
import { LiveCounter } from './components/LiveCounter';
import { DailyTrendChart } from './components/DailyTrendChart';
import { HourlyHeatmap } from './components/HourlyHeatmap';

export default async function SensmaxDashboardPage() {
  const [katowice, wroclaw, poznan] = await Promise.all([
    getRealtimeForShowroom('katowice'),
    getRealtimeForShowroom('wroclaw'),
    getRealtimeForShowroom('poznan'),
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
