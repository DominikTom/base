import { ShowroomCharts } from './components/ShowroomCharts';

export const dynamic = 'force-dynamic';

export default function SensmaxDashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">Showroomy</h1>
        <p className="text-sm text-zinc-500">Liczniki wejść SensMax — wszystkie liczby reagują na zakres dat z górnego paska.</p>
      </div>
      <ShowroomCharts />
    </div>
  );
}
