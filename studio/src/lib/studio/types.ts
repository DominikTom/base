import type { StudioModelId } from './models';

export interface RoomRow {
  id: string;
  name: string;
  base_prompt: string;
  sort_order: number;
  icon: string | null;
}

export interface PackshotRow {
  id: string;
  user_id: string;
  storage_path: string;
  original_filename: string | null;
  width: number | null;
  height: number | null;
  shared: boolean;
  created_at: string;
  deleted_at: string | null;
}

export interface InspirationSetRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  cover_image_id: string | null;
  room_id: string | null;
  shared: boolean;
  created_at: string;
  deleted_at: string | null;
}

export interface InspirationImageRow {
  id: string;
  set_id: string;
  storage_path: string;
  width: number | null;
  height: number | null;
  created_at: string;
}

export type PackshotRole = 'main' | 'addition';

export interface GenerationPackshotRow {
  generation_id: string;
  packshot_id: string;
  role: PackshotRole;
  sort_order: number;
}

/** Maksymalna liczba packshotów w jednej wizualizacji. */
export const MAX_PACKSHOTS_PER_GENERATION = 5;

/** Format kadru generacji — twardo wymuszany na poziomie API modeli. */
export type AspectRatio = '1:1' | '3:4' | '9:16' | '4:3' | '16:9';

export const ASPECT_RATIOS: { id: AspectRatio; labelPl: string }[] = [
  { id: '1:1', labelPl: 'Kwadrat' },
  { id: '3:4', labelPl: 'Pion' },
  { id: '9:16', labelPl: 'Pion (stories)' },
  { id: '4:3', labelPl: 'Poziom' },
  { id: '16:9', labelPl: 'Poziom (szeroki)' },
];

export const DEFAULT_ASPECT_RATIO: AspectRatio = '4:3';

export type GenerationStatus = 'pending' | 'done' | 'error';

export interface GenerationRow {
  id: string;
  user_id: string;
  packshot_id: string | null;
  parent_generation_id: string | null;
  room_id: string | null;
  style_text: string | null;
  inspiration_set_id: string | null;
  inspiration_strength: number | null;
  manual_notes: string | null;
  model: StudioModelId | string;
  full_prompt_sent: string | null;
  mask_storage_path: string | null;
  edit_instruction: string | null;
  edit_reference_paths: string[] | null;
  storage_path: string | null;
  aspect_ratio: string | null;
  width: number | null;
  height: number | null;
  status: GenerationStatus;
  error_message: string | null;
  duration_ms: number | null;
  shared: boolean;
  created_at: string;
  deleted_at: string | null;
}

/** Generacja wzbogacona o dane do wyświetlenia w UI. */
export interface GenerationView extends GenerationRow {
  image_url: string | null;
  room_name?: string | null;
  set_name?: string | null;
  author_name?: string | null;
  packshot_url?: string | null;
}
