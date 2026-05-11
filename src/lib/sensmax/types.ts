export type Showroom = 'krakow' | 'katowice' | 'warszawa' | 'poznan' | 'wroclaw' | 'nowa' | 'marki';

export const SHOWROOMS: Showroom[] = ['krakow', 'katowice', 'warszawa', 'poznan', 'wroclaw', 'nowa', 'marki'];

export const SHOWROOM_LABELS: Record<Showroom, string> = {
  krakow: 'Kraków',
  katowice: 'Katowice',
  warszawa: 'Warszawa',
  poznan: 'Poznań',
  wroclaw: 'Wrocław',
  nowa: 'Nowa',
  marki: 'Marki',
};

export const SHOWROOM_COLORS: Record<Showroom, string> = {
  krakow: '#3b82f6',
  katowice: '#10b981',
  warszawa: '#f59e0b',
  poznan: '#ef4444',
  wroclaw: '#8b5cf6',
  nowa: '#ec4899',
  marki: '#06b6d4',
};

// Mapping of SensMax sensor serial → showroom slug (from GET /api/v2/sensors).
export const SENSOR_SHOWROOM: Record<string, Showroom> = {
  '030013966': 'krakow', // My Bed Krakow
  '030013921': 'katowice', // My Bed Katowice
  '030013965': 'warszawa', // W-wa My Bed
  '030013946': 'poznan', // Poznan My Bed
  '030013954': 'wroclaw', // Wroclaw My
  '030013916': 'nowa', // Nowa My Bed
  '030013934': 'marki', // Marki My Bed
};

export function sensorsForShowroom(showroom: Showroom): string[] {
  return Object.entries(SENSOR_SHOWROOM)
    .filter(([, s]) => s === showroom)
    .map(([serial]) => serial);
}

export interface SensMaxSensor {
  serial: string;
  name: string;
  description: string;
  divideTwo?: boolean;
  negative?: boolean;
  staff: number;
  group: string;
}

export interface SensMaxGroup {
  id: string;
  name: string;
}

// GET /api/v2/sensor/{serial}/data?start=&end=
export interface SensMaxSensorDataDay {
  date: string;
  firstEntryTime: string;
  lastEntryTime: string;
  visits: string[]; // 24 hourly counts as strings
  errors: string[]; // 24 hourly error counts as strings
  battery: 0 | 1;
}

// GET /api/v2/sensor/{serial}/updateddates
export interface SensMaxUpdatedDates {
  serial: string;
  updated_data_dates: string[];
}

export interface ShowroomToday {
  showroom: Showroom;
  visitsToday: number;
  lastEntryTime: string | null; // "HH:MM:SS"
  sensorCount: number;
  fetchedAt: string;
}
