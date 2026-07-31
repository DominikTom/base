-- ============================================================
-- 012: Format kadru generacji (kwadrat / pion / poziom)
-- ============================================================

alter table public.generations
  add column if not exists aspect_ratio text
  check (aspect_ratio in ('1:1', '3:4', '9:16', '4:3', '16:9'));
