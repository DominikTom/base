-- ============================================================
-- 018: Rola "variant" packshota — ten sam mebel w innej konfiguracji
-- (np. sofa złożona + rozłożona do spania w jednej scenie)
-- ============================================================

alter table public.generation_packshots
  drop constraint if exists generation_packshots_role_check;
alter table public.generation_packshots
  add constraint generation_packshots_role_check
  check (role in ('main', 'variant', 'addition'));
