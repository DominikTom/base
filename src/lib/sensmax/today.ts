import { fetchSensMax } from './client';
import { SENSOR_DIVIDE_TWO, sensorsForShowroom, type SensMaxSensorDataDay, type Showroom, type ShowroomToday } from './types';

const TODAY_TTL_SEC = 120;

function todayWarsaw(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function getShowroomToday(showroom: Showroom): Promise<ShowroomToday> {
  const serials = sensorsForShowroom(showroom);
  const date = todayWarsaw();

  let visitsToday = 0;
  let lastEntryTime: string | null = null;

  await Promise.all(
    serials.map(async (serial) => {
      try {
        const days = await fetchSensMax<SensMaxSensorDataDay[]>(
          `/sensor/${serial}/data?start=${date}&end=${date}`,
          'today',
          { serial, revalidateSec: TODAY_TTL_SEC, log: false },
        );
        let rawSum = 0;
        for (const day of days) {
          if (day.date !== date) continue;
          for (const v of day.visits ?? []) rawSum += Number.parseInt(v, 10) || 0;
          const t = day.lastEntryTime;
          if (t && t !== '00:00:00' && (lastEntryTime === null || t > lastEntryTime)) lastEntryTime = t;
        }
        visitsToday += SENSOR_DIVIDE_TWO[serial] ? Math.floor(rawSum / 2) : rawSum;
      } catch {
        /* a single sensor failing shouldn't blank the whole showroom card */
      }
    }),
  );

  return { showroom, visitsToday, lastEntryTime, sensorCount: serials.length, fetchedAt: new Date().toISOString() };
}
