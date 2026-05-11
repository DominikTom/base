'use client';

import { useEffect, useState } from 'react';
import type { RealtimeSnapshot, Showroom } from '@/lib/sensmax/types';

export function LiveCounter({ showroom, initial }: { showroom: Showroom; initial: RealtimeSnapshot }) {
  const [data, setData] = useState(initial);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let mounted = true;

    const tick = async () => {
      setNowMs(Date.now());
      const res = await fetch(`/api/sensmax/realtime/${showroom}`);
      if (!res.ok || !mounted) return;
      setData((await res.json()) as RealtimeSnapshot);
    };

    const id = setInterval(tick, 60_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [showroom]);

  const sensorUpdateMs = data.sensor_last_update ? new Date(data.sensor_last_update).getTime() : 0;
  const stale = sensorUpdateMs === 0 || nowMs - sensorUpdateMs > 15 * 60_000;
  const offline = data.offline || stale;

  return (
    <div className="rounded-lg border p-4">
      <h3 className="font-semibold capitalize">{showroom}</h3>
      <p className="text-3xl font-bold">{data.inside ?? 0}</p>
      <p className="text-sm">Maks: {data.max_capacity ?? '-'}</p>
      <p className={`text-sm ${offline ? 'text-red-600' : 'text-green-600'}`}>{offline ? 'Offline' : 'Online'}</p>
    </div>
  );
}
