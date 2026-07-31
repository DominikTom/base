-- ============================================================
-- 013: Komentarz per packshot ("gdzie ustawić, co na nim położyć")
-- ============================================================

alter table public.generation_packshots
  add column if not exists note text;
