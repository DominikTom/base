import { getShowroomToday } from '@/lib/sensmax/today';
import { SHOWROOMS, type ShowroomToday } from '@/lib/sensmax/types';
import { TodayCard } from './components/TodayCard';
import { ShowroomCharts } from './components/ShowroomCharts';

export const dynamic = 'force-dynamic';

export default async function SensmaxDashboardPage() {
  const todays = await Promise.all(
    SHOWROOMS.map((showroom) =>
      getShowroomToday(showroom).catch(
        (): ShowroomToday => ({ showroom, visitsToday: 0, lastEntryTime: null, sensorCount: 0, fetchedAt: new Date(0).toISOString() }),
      ),
    ),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">Showroomy</h1>
        <p className="text-sm text-zinc-500">Liczniki wejść SensMax — dzienne wejścia na żywo oraz historia.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {todays.map((t) => (
          <TodayCard key={t.showroom} initial={t} />
        ))}
      </div>

      <ShowroomCharts />
    </div>
  );
}
