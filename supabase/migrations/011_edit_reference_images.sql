-- ============================================================
-- 011: Obrazy referencyjne dla edycji pędzlem (wstawianie/podmiana
-- konkretnych produktów w zaznaczonym obszarze)
-- ============================================================

alter table public.generations
  add column if not exists edit_reference_paths text[];
