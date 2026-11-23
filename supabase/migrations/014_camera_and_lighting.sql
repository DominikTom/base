-- ============================================================
-- 014: Ujęcie, kąt kamery i oświetlenie generacji
-- ============================================================

alter table public.generations
  add column if not exists camera_shot text
    check (camera_shot in ('wide', 'medium', 'close')),
  add column if not exists camera_angle text
    check (camera_angle in ('front', 'three-quarter-left', 'three-quarter-right', 'side', 'low', 'elevated')),
  add column if not exists lighting text
    check (lighting in ('morning', 'daylight-soft', 'golden', 'evening', 'studio'));
