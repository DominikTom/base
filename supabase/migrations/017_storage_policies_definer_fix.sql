-- ============================================================
-- 017: Naprawa uploadu inspiracji — polityki Storage przez funkcje
-- SECURITY DEFINER zamiast zagnieżdżonych podzapytań (w kontekście
-- storage-api podzapytanie do tabel public nie widzi wierszy mimo
-- poprawnego auth.uid(); sprawdzenia folderowe działają).
-- ============================================================

create or replace function public.inspiration_set_accessible(folder text, uid uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.inspiration_sets s
    where s.id::text = folder and (s.user_id = uid or s.shared)
  );
$$;
revoke all on function public.inspiration_set_accessible(text, uuid) from public, anon;
grant execute on function public.inspiration_set_accessible(text, uuid) to authenticated;

create or replace function public.packshot_file_shared(path text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.packshots p where p.storage_path = path and p.shared
  );
$$;
revoke all on function public.packshot_file_shared(text) from public, anon;
grant execute on function public.packshot_file_shared(text) to authenticated;

create or replace function public.generation_file_shared(path text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.generations g
    where g.shared
      and (g.storage_path = path
           or path = any (coalesce(g.edit_reference_paths, array[]::text[])))
  );
$$;
revoke all on function public.generation_file_shared(text) from public, anon;
grant execute on function public.generation_file_shared(text) to authenticated;

drop policy if exists "inspirations_files_select" on storage.objects;
drop policy if exists "inspirations_files_insert" on storage.objects;
drop policy if exists "inspirations_files_delete" on storage.objects;
drop policy if exists "packshots_files_select" on storage.objects;
drop policy if exists "generations_files_select" on storage.objects;

create policy "inspirations_files_select" on storage.objects
  for select to authenticated using (
    bucket_id = 'inspirations'
    and public.inspiration_set_accessible((storage.foldername(name))[1], (select auth.uid()))
  );
create policy "inspirations_files_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'inspirations'
    and public.inspiration_set_accessible((storage.foldername(name))[1], (select auth.uid()))
  );
create policy "inspirations_files_delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'inspirations'
    and public.inspiration_set_accessible((storage.foldername(name))[1], (select auth.uid()))
  );

create policy "packshots_files_select" on storage.objects
  for select to authenticated using (
    bucket_id = 'packshots' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.packshot_file_shared(name)
    )
  );

create policy "generations_files_select" on storage.objects
  for select to authenticated using (
    bucket_id = 'generations' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or ((storage.foldername(name))[1] = 'masks'
          and (storage.foldername(name))[2] = (select auth.uid())::text)
      or ((storage.foldername(name))[1] = 'edit-refs'
          and (storage.foldername(name))[2] = (select auth.uid())::text)
      or public.generation_file_shared(name)
    )
  );
