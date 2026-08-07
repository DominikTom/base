import { ShowroomCharts } from './components/ShowroomCharts';

export const dynamic = 'force-dynamic';

export default function SensmaxDashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Showroomy</h1>
        <p className="text-sm text-ink-muted">Liczniki wejść SensMax — wszystkie liczby reagują na zakres dat z górnego paska.</p>
      </div>
      <ShowroomCharts />
    </div>
  );
}
