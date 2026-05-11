export interface SensMaxReport {
  id: number;
  name: string;
  date: string;
  currentTime: string;
  inside: number;
  max: number;
  almostFullPreset: number;
  offline: boolean;
  color: string;
  message: string;
  messageWhenLimitReached?: string;
  messageWhenAlmostFullReached?: string;
  messageWhenFree?: string;
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

export interface SensMaxSensorDataDay {
  date: string;
  firstEntryTime: string;
  lastEntryTime: string;
  visits: string[];
  errors: string[];
  battery: 0 | 1;
}

export type Showroom = 'katowice' | 'wroclaw' | 'poznan';

export interface RealtimeSnapshot {
  showroom: Showroom;
  inside: number | null;
  max_capacity: number | null;
  almost_full: number | null;
  offline: boolean;
  color: string | null;
  message: string | null;
  sensor_last_update: string | null;
  fetched_at: string;
}
