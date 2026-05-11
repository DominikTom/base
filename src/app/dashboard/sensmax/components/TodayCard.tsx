'use client';

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { KpiCard } from '@/components/ui/kpi-card';
import { SHOWROOM_LABELS, type ShowroomToday } from '@/lib/sensmax/types';

export function TodayCard({ initial }: { initial: ShowroomToday }) {
  const [data, setData] = useState(initial);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/sensmax/today/${initial.showroom}`);
        if (!res.ok) return;
        const json = (await res.json()) as ShowroomToday & { error?: string };
        if (alive && !json.error) setData(json);
      } catch {
        /* ignore transient poll errors */
      }
    };
    const id = setInterval(tick, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [initial.showroom]);

  return (
    <KpiCard
      title={SHOWROOM_LABELS[data.showroom]}
      value={data.visitsToday.toLocaleString('pl-PL')}
      subLabel={data.lastEntryTime ? `wejść dziś — ostatnie ${data.lastEntryTime.slice(0, 5)}` : 'wejść dziś (brak ruchu)'}
      icon={<Users size={16} />}
    />
  );
}
