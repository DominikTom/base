-- ============================================================
-- 016: Prywatność per użytkownik — domyślnie prywatne, udostępnianie
--      świadome (przycisk). Zaostrzenie polityk Storage do katalogów
--      właściciela + wyjątek dla udostępnionych rekordów.
-- ============================================================

-- ---------- Domyślnie prywatne ----------
alter table public.packshots alter column shared set default false;
alter table public.inspiration_sets alter column shared set default false;
alter table public.generations alter column shared set default false;
alter table public.creator_templates alter column shared set default false;

-- Istniejące dane: rozdzielenie kont (wszystko wraca do właściciela).
update public.packshots set shared = false where shared;
update public.inspiration_sets set shared = false where shared;
update public.generations set shared = false where shared;
update public.creator_templates set shared = false where shared;

-- ---------- Storage: dostęp tylko do własnych katalogów + udostępnione ----------
drop policy if exists "studio_buckets_select" on storage.objects;
drop policy if exists "studio_buckets_insert" on storage.objects;
drop policy if exists "studio_buckets_update" on storage.objects;
drop policy if exists "studio_buckets_delete" on storage.objects;

-- PACKSHOTS: pliki w {userId}/...
create policy "packshots_files_select" on storage.objects
  for select to authenticated using (
    bucket_id = 'packshots' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1 from public.packshots p
        where p.storage_path = name and p.shared
      )
    )
  );
create policy "packshots_files_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'packshots' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "packshots_files_delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'packshots' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- INSPIRATIONS: pliki w {setId}/... — dostęp przez właściciela/udostępnienie zestawu.
create policy "inspirations_files_select" on storage.objects
  for select to authenticated using (
    bucket_id = 'inspirations' and exists (
      select 1 from public.inspiration_sets s
      where s.id::text = (storage.foldername(name))[1]
        and (s.user_id = (select auth.uid()) or s.shared)
    )
  );
create policy "inspirations_files_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'inspirations' and exists (
      select 1 from public.inspiration_sets s
      where s.id::text = (storage.foldername(name))[1]
        and (s.user_id = (select auth.uid()) or s.shared)
    )
  );
create policy "inspirations_files_delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'inspirations' and exists (
      select 1 from public.inspiration_sets s
      where s.id::text = (storage.foldername(name))[1]
        and (s.user_id = (select auth.uid()) or s.shared)
    )
  );

-- GENERATIONS: wyniki w {userId}/..., maski w masks/{userId}/...,
-- referencje edycji w edit-refs/{userId}/...; cudze tylko gdy generacja shared.
create policy "generations_files_select" on storage.objects
  for select to authenticated using (
    bucket_id = 'generations' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or ((storage.foldername(name))[1] = 'masks'
          and (storage.foldername(name))[2] = (select auth.uid())::text)
      or ((storage.foldername(name))[1] = 'edit-refs'
          and (storage.foldername(name))[2] = (select auth.uid())::text)
      or exists (
        select 1 from public.generations g
        where g.shared
          and (g.storage_path = name
               or name = any (coalesce(g.edit_reference_paths, array[]::text[])))
      )
    )
  );
create policy "generations_files_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'generations' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or ((storage.foldername(name))[1] = 'masks'
          and (storage.foldername(name))[2] = (select auth.uid())::text)
      or ((storage.foldername(name))[1] = 'edit-refs'
          and (storage.foldername(name))[2] = (select auth.uid())::text)
    )
  );
create policy "generations_files_delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'generations' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or ((storage.foldername(name))[1] = 'masks'
          and (storage.foldername(name))[2] = (select auth.uid())::text)
      or ((storage.foldername(name))[1] = 'edit-refs'
          and (storage.foldername(name))[2] = (select auth.uid())::text)
    )
  );
